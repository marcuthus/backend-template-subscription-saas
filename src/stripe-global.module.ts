import { StripeModule } from "@golevelup/nestjs-stripe"
import { SkipThrottle } from "@nestjs/throttler"
import { Global, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"

@Global()
@Module({
    imports: [
        StripeModule.forRootAsync({
            useFactory: (configService: ConfigService) => ({
                apiKey: configService.getOrThrow<string>("STRIPE_API_KEY"),
                apiVersion: "2026-02-25.clover",
                webhookConfig: {
                    stripeSecrets: {
                        account: configService.getOrThrow<string>("STRIPE_WEBHOOK_SECRET"),
                    },
                    requestBodyProperty: "rawBody",
                    // O Stripe envia eventos em rajadas; o rate limit global não deve recusá-los.
                    decorators: [SkipThrottle()],
                },
            }),
            inject: [ConfigService],
        }),
    ],
    exports: [StripeModule],
})
export class StripeGlobalModule {}
