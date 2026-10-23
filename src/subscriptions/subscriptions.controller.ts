import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common"
import { ApiBearerAuth } from "@nestjs/swagger"

import { CreateCheckoutSessionDto } from "./dto/create-checkout-session.dto"
import { InjectUser } from "../auth/decorators/inject-user.decorator"
import { SubscriptionsService } from "./subscriptions.service"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"

@Controller("subscriptions")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubscriptionsController {
    constructor(private readonly subscriptionsService: SubscriptionsService) {}

    @Get("me")
    async findMine(@InjectUser("id") userId: string) {
        return await this.subscriptionsService.findOneByUserId(userId)
    }

    @Post("checkout")
    async createCheckoutSession(
        @InjectUser("id") userId: string,
        @Body() createCheckoutSessionDto: CreateCheckoutSessionDto,
    ) {
        return await this.subscriptionsService.createCheckoutSession(userId, createCheckoutSessionDto.planId)
    }

    @Post("portal")
    async createBillingPortalSession(@InjectUser("id") userId: string) {
        return await this.subscriptionsService.createBillingPortalSession(userId)
    }
}
