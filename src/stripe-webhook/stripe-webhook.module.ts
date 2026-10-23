import { Module } from "@nestjs/common"

import { DiscordWebhookModule } from "../discord-webhook/discord-webhook.module"
import { SubscriptionsModule } from "../subscriptions/subscriptions.module"
import { StripeWebhookService } from "./stripe-webhook.service"
import { configHelper } from "../helpers/config.helper"

@Module({
    imports: [
        DiscordWebhookModule.forFeature({
            name: "Stripe",
            url: configHelper.discordWebhookUrls.stripeWebhook,
        }),
        SubscriptionsModule,
    ],
    providers: [StripeWebhookService],
})
export class StripeWebhookModule {}
