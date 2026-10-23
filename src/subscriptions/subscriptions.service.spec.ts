import { BadRequestException, NotFoundException } from "@nestjs/common"

import { SubscriptionsService } from "./subscriptions.service"
import { configHelper } from "../helpers/config.helper"

const FREE = configHelper.plans.free.id
const PRO = configHelper.plans.pro.id
const ADMIN = configHelper.plans.admin.id

function makeStripeSubscription(overrides: Record<string, any> = {}) {
    return {
        id: "sub_pro",
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        items: {
            data: [
                {
                    id: "si_1",
                    price: { id: "price_pro" },
                    current_period_start: 1_700_000_000,
                    current_period_end: 1_702_592_000,
                },
            ],
        },
        ...overrides,
    } as any
}

describe("SubscriptionsService", () => {
    let service: SubscriptionsService
    let prisma: any
    let stripe: any
    let user: any

    beforeEach(() => {
        user = {
            id: "user-1",
            planId: FREE,
            stripeCustomerId: "cus_1",
            subscription: { externalId: "sub_free", status: "active" },
        }

        prisma = {
            user: {
                findUnique: jest.fn().mockImplementation(async () => user),
                update: jest.fn().mockImplementation((args) => ({ op: "user.update", args })),
            },
            plan: {
                findUnique: jest.fn().mockImplementation(async ({ where }) => {
                    if (where.externalPriceId === "price_pro" || where.id === PRO) {
                        return { id: PRO, externalPriceId: "price_pro" }
                    }
                    if (where.externalPriceId === "price_free" || where.id === FREE) {
                        return { id: FREE, externalPriceId: "price_free" }
                    }
                    return null
                }),
            },
            subscription: {
                findUnique: jest.fn(),
                update: jest.fn(),
                upsert: jest.fn().mockImplementation((args) => ({ op: "subscription.upsert", args })),
            },
            $transaction: jest.fn().mockResolvedValue([]),
        }

        stripe = {
            subscriptions: { cancel: jest.fn().mockResolvedValue({}) },
            checkout: { sessions: { create: jest.fn().mockResolvedValue({ id: "cs_1", url: "https://checkout" }) } },
            billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: "https://portal" }) } },
        }

        service = new SubscriptionsService(stripe, prisma)
    })

    describe("syncFromStripe", () => {
        it("libera o plano pago quando a nova assinatura (checkout) está ativa e cancela a gratuita", async () => {
            const result = await service.syncFromStripe(makeStripeSubscription())

            expect(result).toMatchObject({ ignored: false, planId: PRO })
            expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { planId: PRO } })
            expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_free")
        })

        it("não libera o plano pago para assinatura incompleta (sem pagamento)", async () => {
            const result = await service.syncFromStripe(makeStripeSubscription({ status: "incomplete" }))

            expect(result.ignored).toBe(true)
            expect(prisma.$transaction).not.toHaveBeenCalled()
            expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
        })

        it("rebaixa para o plano gratuito quando a assinatura vigente é cancelada", async () => {
            user.planId = PRO
            user.subscription = { externalId: "sub_pro", status: "active" }

            const result = await service.syncFromStripe(makeStripeSubscription({ status: "canceled" }))

            expect(result).toMatchObject({ ignored: false, planId: FREE })
            expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { planId: FREE } })
        })

        it("rebaixa para o plano gratuito quando o pagamento falha (past_due/unpaid)", async () => {
            user.planId = PRO
            user.subscription = { externalId: "sub_pro", status: "active" }

            const result = await service.syncFromStripe(makeStripeSubscription({ status: "unpaid" }))

            expect(result.planId).toBe(FREE)
        })

        it("ignora eventos de uma assinatura antiga já substituída", async () => {
            user.planId = PRO
            user.subscription = { externalId: "sub_pro", status: "active" }

            const result = await service.syncFromStripe(
                makeStripeSubscription({
                    id: "sub_free",
                    status: "canceled",
                    items: {
                        data: [
                            { id: "si_0", price: { id: "price_free" }, current_period_start: 1, current_period_end: 2 },
                        ],
                    },
                }),
            )

            expect(result.ignored).toBe(true)
            expect(prisma.user.update).not.toHaveBeenCalled()
        })

        it("mantém o plano de admin", async () => {
            user.planId = ADMIN
            user.subscription = null

            const result = await service.syncFromStripe(makeStripeSubscription({ status: "canceled" }))

            expect(result.planId).toBe(ADMIN)
        })

        it("lança erro (para o Stripe reenviar) quando o cliente ainda não existe no banco", async () => {
            user = null
            await expect(service.syncFromStripe(makeStripeSubscription())).rejects.toBeInstanceOf(NotFoundException)
        })

        it("grava os períodos na ordem correta", async () => {
            user.subscription = { externalId: "sub_pro", status: "active" }
            await service.syncFromStripe(makeStripeSubscription())

            const upsertArgs = prisma.subscription.upsert.mock.calls[0][0]
            expect(upsertArgs.update.currentPeriodStart.getTime()).toBe(1_700_000_000 * 1000)
            expect(upsertArgs.update.currentPeriodEnd.getTime()).toBe(1_702_592_000 * 1000)
        })
    })

    describe("createCheckoutSession", () => {
        it("cria a sessão de checkout com o preço do plano", async () => {
            const session = await service.createCheckoutSession("user-1", PRO)

            expect(session).toEqual({ id: "cs_1", url: "https://checkout" })
            expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    mode: "subscription",
                    customer: "cus_1",
                    line_items: [{ price: "price_pro", quantity: 1 }],
                }),
            )
        })

        it("não permite checkout dos planos gratuito e admin", async () => {
            await expect(service.createCheckoutSession("user-1", FREE)).rejects.toBeInstanceOf(BadRequestException)
            await expect(service.createCheckoutSession("user-1", ADMIN)).rejects.toBeInstanceOf(BadRequestException)
        })

        it("não permite um segundo checkout para quem já tem plano pago ativo", async () => {
            user.planId = PRO
            await expect(service.createCheckoutSession("user-1", PRO)).rejects.toBeInstanceOf(BadRequestException)
        })
    })

    it("cria a sessão do portal de cobrança", async () => {
        await expect(service.createBillingPortalSession("user-1")).resolves.toEqual({ url: "https://portal" })
    })

    it("updateByUserId filtra pelo userId (e não pelo id da assinatura)", async () => {
        prisma.subscription.findUnique.mockResolvedValue({ id: "subscription-id" })
        await service.updateByUserId("user-1", { status: "active" })
        expect(prisma.subscription.update).toHaveBeenCalledWith({
            where: { userId: "user-1" },
            data: { status: "active" },
        })
    })
})
