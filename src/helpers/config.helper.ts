import { ValidationPipe } from "@nestjs/common"

import * as dotenv from "dotenv"

const isProduction = process.env.NODE_ENV === "production"

dotenv.config()

export const configHelper = {
    isProduction: isProduction,
    isDevelopment: !isProduction,
    app: {
        metadata: {
            name: "Bolierplate",
            version: "0.0.1",
        },
        port: process.env.PORT || 3003,
        validationPipe: new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
        cors: {
            methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
            origin: process.env.CORS_ORIGIN || true,
            credentials: true,
        },
    },
    frontend: {
        url: process.env.FRONTEND_URL || "http://localhost:3000",
        resetPasswordPath: "/reset-password",
        checkoutSuccessPath: "/billing/success",
        checkoutCancelPath: "/billing/cancel",
        billingPortalReturnPath: "/billing",
    },
    pagination: {
        minPage: 1,
        defaultPage: 1,
        minPerPage: 2,
        defaultPerPage: 20,
        maxPerPage: 50,
    },
    users: {
        apiKey: {
            prefix: "dev_",
            randomCharsLength: 32,
        },
        minNameLength: 3,
        maxNameLength: 100,
        minUsernameLength: 4,
        maxUsernameLength: 16,
        maxEmailLength: 150,
        generatedUsernameLength: 8,
    },
    discordWebhookUrls: {
        stripeWebhook: process.env.DISCORD_STRIPE_WEBHOOK_URL!,
        users: process.env.DISCORD_USERS_WEBHOOK_URL!,
    },
    plans: {
        free: {
            id: "58e14257-d83b-4c6e-bfad-9587efcf2b7f",
        },
        pro: {
            id: "846e2582-771d-4a50-ae4f-faa650d9a697",
        },
        admin: {
            id: "4cf3ebea-5f26-41bc-b35a-7d21bb081dbd",
        },
    },
}
