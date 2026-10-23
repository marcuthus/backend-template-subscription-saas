import { ConflictException } from "@nestjs/common"

import { configHelper } from "../helpers/config.helper"
import { UsersService } from "./users.service"

const FREE = configHelper.plans.free.id
const PRO = configHelper.plans.pro.id

function makeStripeSubscription(status: string) {
    return {
        id: "sub_1",
        status: status,
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        items: { data: [{ id: "si_1", current_period_start: 1, current_period_end: 2 }] },
    }
}

describe("UsersService", () => {
    let service: UsersService
    let prisma: any
    let stripe: any

    const createUserDto = {
        name: "User",
        username: "user",
        email: "user@email.com",
        password: "Senha@123",
        planId: FREE,
    }

    beforeEach(() => {
        prisma = {
            user: {
                findFirst: jest.fn().mockResolvedValue(null),
                findUnique: jest.fn(),
                create: jest.fn().mockImplementation(async ({ data }) => ({ id: "user-1", ...data })),
                update: jest.fn().mockResolvedValue({ id: "user-1" }),
                delete: jest.fn().mockResolvedValue({}),
            },
            plan: {
                findUnique: jest.fn().mockImplementation(async ({ where }) => ({
                    id: where.id,
                    externalPriceId: where.id === PRO ? "price_pro" : "price_free",
                })),
            },
        }

        stripe = {
            customers: {
                list: jest.fn(),
                create: jest.fn().mockResolvedValue({ id: "cus_1" }),
                del: jest.fn().mockResolvedValue({}),
            },
            subscriptions: {
                create: jest.fn().mockResolvedValue(makeStripeSubscription("active")),
                cancel: jest.fn().mockResolvedValue({}),
            },
        }

        const crypto = {
            encrypt: jest.fn().mockReturnValue("encrypted"),
            hashPassword: jest.fn().mockResolvedValue("hash"),
        }

        service = new UsersService(
            { safeNotify: jest.fn() } as any,
            stripe,
            crypto as any,
            { send: jest.fn() } as any,
            { getOrThrow: jest.fn().mockReturnValue("noreply@email.com") } as any,
            prisma,
        )
    })

    describe("create", () => {
        it("usa o price id do Stripe do plano (e não o id interno do plano)", async () => {
            await service.create(createUserDto)

            expect(stripe.subscriptions.create).toHaveBeenCalledWith({
                customer: "cus_1",
                items: [{ price: "price_free" }],
            })
        })

        it("não reaproveita clientes do Stripe pelo email", async () => {
            await service.create(createUserDto)
            expect(stripe.customers.list).not.toHaveBeenCalled()
            expect(stripe.customers.create).toHaveBeenCalled()
        })

        it("mantém o usuário no plano gratuito se a assinatura paga não estiver ativa", async () => {
            stripe.subscriptions.create.mockResolvedValue(makeStripeSubscription("incomplete"))

            await service.create({ ...createUserDto, planId: PRO })

            expect(prisma.user.create.mock.calls[0][0].data.planId).toBe(FREE)
        })

        it("detecta email duplicado mesmo com username diferente", async () => {
            prisma.user.findFirst.mockResolvedValue({ email: createUserDto.email, username: "outro" })

            await expect(service.create(createUserDto)).rejects.toBeInstanceOf(ConflictException)
            expect(prisma.user.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { OR: [{ email: createUserDto.email }, { username: createUserDto.username }] },
                }),
            )
            expect(stripe.customers.create).not.toHaveBeenCalled()
        })

        it("remove o cliente do Stripe se a gravação no banco falhar", async () => {
            prisma.user.create.mockRejectedValue(new Error("db error"))

            await expect(service.create(createUserDto)).rejects.toThrow("db error")
            expect(stripe.customers.del).toHaveBeenCalledWith("cus_1")
        })

        it("retorna a API key em texto puro apenas na criação, sem a senha", async () => {
            const user = await service.create(createUserDto)
            expect(user.apiKey).toMatch(/^dev_/)
            expect(prisma.user.create.mock.calls[0][0].omit).toEqual({ password: true, apiKey: true })
        })
    })

    it("update não retorna a senha nem a API key", async () => {
        prisma.user.findUnique.mockResolvedValue({ id: "user-1" })

        await service.update("user-1", { name: "Novo nome" })

        expect(prisma.user.update.mock.calls[0][0].omit).toEqual({ password: true, apiKey: true })
    })

    it("remove cancela a assinatura no Stripe antes de excluir o usuário", async () => {
        prisma.user.findUnique.mockResolvedValue({
            id: "user-1",
            subscription: { externalId: "sub_1", status: "active" },
        })

        await service.remove("user-1")

        expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_1")
        expect(prisma.user.delete).toHaveBeenCalled()
    })
})
