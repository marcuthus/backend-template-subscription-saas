import { InjectStripeClient, StripeWebhookHandler } from "@golevelup/nestjs-stripe"
import { Injectable, Logger } from "@nestjs/common"
import Stripe from "stripe"

import { DiscordWebhookService } from "../discord-webhook/discord-webhook.service"
import { SubscriptionsService } from "../subscriptions/subscriptions.service"

type SubscriptionEvent =
    | Stripe.CustomerSubscriptionCreatedEvent
    | Stripe.CustomerSubscriptionUpdatedEvent
    | Stripe.CustomerSubscriptionDeletedEvent
    | Stripe.CustomerSubscriptionPausedEvent
    | Stripe.CustomerSubscriptionResumedEvent

@Injectable()
export class StripeWebhookService {
    private readonly logger = new Logger(StripeWebhookService.name)

    constructor(
        @InjectStripeClient() private readonly stripe: Stripe,
        private readonly discordWebookService: DiscordWebhookService,
        private readonly subscriptionsService: SubscriptionsService,
    ) {}

    /**
     * Os eventos do Stripe podem chegar fora de ordem, então em vez de confiar no payload
     * do evento a assinatura é buscada novamente na API para obter o estado mais recente.
     */
    private async syncSubscription(event: SubscriptionEvent, title: string) {
        const subscription = await this.stripe.subscriptions.retrieve(event.data.object.id)
        const result = await this.subscriptionsService.syncFromStripe(subscription)

        if (result.ignored) {
            this.logger.log(`Ignored ${event.type} for non-current subscription ${subscription.id}`)
            return
        }

        this.discordWebookService.safeNotify({
            nameSuffix: event.type,
            type: result.status === "active" || result.status === "trialing" ? "success" : "warn",
            title: title,
            message: `Id do usuário: ${result.userId}\nAssinatura: ${subscription.id}\nStatus: ${result.status}\nPlano: ${result.planId}`,
        })
    }

    @StripeWebhookHandler("customer.subscription.created")
    async handleCreatedSubscription(event: Stripe.CustomerSubscriptionCreatedEvent) {
        await this.syncSubscription(event, "Assinatura criada")
    }

    @StripeWebhookHandler("customer.subscription.updated")
    async handleUpdatedSubscription(event: Stripe.CustomerSubscriptionUpdatedEvent) {
        await this.syncSubscription(event, "Assinatura atualizada")
    }

    @StripeWebhookHandler("customer.subscription.deleted")
    async handleDeletedSubscription(event: Stripe.CustomerSubscriptionDeletedEvent) {
        await this.syncSubscription(event, "Assinatura cancelada")
    }

    @StripeWebhookHandler("customer.subscription.paused")
    async handlePausedSubscription(event: Stripe.CustomerSubscriptionPausedEvent) {
        await this.syncSubscription(event, "Assinatura pausada")
    }

    @StripeWebhookHandler("customer.subscription.resumed")
    async handleResumedSubscription(event: Stripe.CustomerSubscriptionResumedEvent) {
        await this.syncSubscription(event, "Assinatura retomada")
    }

    @StripeWebhookHandler("checkout.session.expired")
    async handleExpiredCheckoutSession(event: Stripe.CheckoutSessionExpiredEvent) {
        const session = event.data.object

        this.discordWebookService.safeNotify({
            nameSuffix: "Expired",
            type: "error",
            title: `Sessão de checkout expirada`,
            message: `Sessão ID: ${session.id}\nCliente: ${session.customer}`,
        })
    }
}
