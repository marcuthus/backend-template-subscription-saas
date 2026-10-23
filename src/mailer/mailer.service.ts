import { Injectable, Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { BrevoClient } from "@getbrevo/brevo"

import { configHelper } from "../helpers/config.helper"

export type SendEmailOptions = {
    to: string
    subject: string
    htmlContent: string
    senderName?: string
    senderEmail: string
}

export type SendCreatedAccountEmail = {
    email: string
    name: string
}

@Injectable()
export class MailerService {
    private readonly client: BrevoClient
    private readonly logger = new Logger(MailerService.name)

    constructor(private config: ConfigService) {
        const apiKey = this.config.getOrThrow<string>("BREVO_API_KEY")
        this.client = new BrevoClient({ apiKey: apiKey })
    }

    async send({ htmlContent, subject, to, senderEmail, senderName }: SendEmailOptions): Promise<boolean> {
        try {
            const sender = {
                email: senderEmail,
                name: senderName || configHelper.app.metadata.name,
            }

            await this.client.transactionalEmails.sendTransacEmail({
                sender: sender,
                to: [
                    {
                        email: to,
                    },
                ],
                subject: subject,
                htmlContent: htmlContent,
            })

            return true
        } catch (error) {
            this.logger.error("ERROR SENDING EMAIL: ", error)
            return false
        }
    }
}
