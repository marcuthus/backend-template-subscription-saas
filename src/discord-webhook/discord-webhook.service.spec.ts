import { Test, TestingModule } from "@nestjs/testing"

import { DiscordWebhookService } from "./discord-webhook.service"

describe("DiscordWebhookService", () => {
    let service: DiscordWebhookService

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DiscordWebhookService,
                { provide: "WEBHOOK_URL_KEY", useValue: "https://discord.com/api/webhooks/1/token" },
                { provide: "WEBHOOK_NAME_KEY", useValue: "Test" },
            ],
        }).compile()

        service = module.get<DiscordWebhookService>(DiscordWebhookService)
    })

    it("should be defined", () => {
        expect(service).toBeDefined()
    })
})
