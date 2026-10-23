import { StripeWebhookService } from "./stripe-webhook.service"

describe("StripeWebhookService", () => {
    let service: StripeWebhookService
    let stripe: any
    let subscriptionsService: any
    let discord: any

    beforeEach(() => {
        stripe = {
            subscriptions: {
                retrieve: jest.fn().mockResolvedValue({ id: "sub_1", status: "canceled" }),
            },
        }
        subscriptionsService = {
            syncFromStripe: jest
                .fn()
                .mockResolvedValue({ ignored: false, userId: "u", planId: "p", status: "canceled" }),
        }
        discord = { safeNotify: jest.fn() }

        service = new StripeWebhookService(stripe, discord, subscriptionsService)
    })

    it("busca o estado mais recente da assinatura antes de sincronizar", async () => {
        await service.handleDeletedSubscription({
            type: "customer.subscription.deleted",
            data: { object: { id: "sub_1", status: "active" } },
        } as any)

        expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1")
        expect(subscriptionsService.syncFromStripe).toHaveBeenCalledWith({ id: "sub_1", status: "canceled" })
        expect(discord.safeNotify).toHaveBeenCalled()
    })

    it("não notifica eventos ignorados", async () => {
        subscriptionsService.syncFromStripe.mockResolvedValue({ ignored: true })

        await service.handleUpdatedSubscription({
            type: "customer.subscription.updated",
            data: { object: { id: "sub_1" } },
        } as any)

        expect(discord.safeNotify).not.toHaveBeenCalled()
    })
})
