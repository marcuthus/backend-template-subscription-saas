import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common"
import { InjectStripeClient } from "@golevelup/nestjs-stripe"
import Stripe from "stripe"

import { getCurrentSubscriptionPeriods } from "../utils/get-stripe-current-subscription-periods.util"
import { getStripeSubscriptionPriceId } from "../utils/get-stripe-subscription-price-id.util"
import { getStripeSubscriptionItemId } from "../utils/get-stripe-subscription-item-id.util"
import { isSubscriptionEntitled } from "../utils/subscription-entitlement.util"
import { getStripeCustomerId } from "../utils/get-stripe-customer-id.util"
import { UpdateSubscriptionDto } from "./dto/update-subscription.dto"
import { SubscriptionStatus } from "../generated/prisma/enums"
import { messagesHelper } from "../helpers/messages.helper"
import { PrismaService } from "../prisma/prisma.service"
import { configHelper } from "../helpers/config.helper"

export type SyncSubscriptionResult = {
    ignored: boolean
    userId?: string
    planId?: string
    status?: string
}

@Injectable()
export class SubscriptionsService {
    private readonly logger = new Logger(SubscriptionsService.name)

    constructor(
        @InjectStripeClient() private readonly stripe: Stripe,
        private readonly prisma: PrismaService,
    ) {}

    async findOneByUserId(userId: string) {
        const subscription = await this.prisma.subscription.findUnique({
            where: {
                userId: userId,
            },
        })

        if (!subscription) {
            throw new NotFoundException(messagesHelper.SUBSCRIPTION_NOT_FOUND)
        }

        return subscription
    }

    async updateByUserId(userId: string, updateSubscriptionDto: UpdateSubscriptionDto) {
        const existingSubscription = await this.prisma.subscription.findUnique({
            where: {
                userId: userId,
            },
            select: {
                id: true,
            },
        })

        if (!existingSubscription) {
            throw new NotFoundException(
                messagesHelper.OBJECT_NOT_FOUND({
                    name: "Subscription",
                    property: "userId",
                    value: userId,
                }),
            )
        }

        return await this.prisma.subscription.update({
            where: {
                userId: userId,
            },
            data: updateSubscriptionDto,
        })
    }

    /**
     * Sincroniza o estado de uma assinatura do Stripe com o banco: grava os dados da assinatura
     * e define o plano do usuário. O plano pago só é liberado com status "active"/"trialing";
     * em qualquer outro status o usuário volta para o plano gratuito.
     */
    async syncFromStripe(stripeSubscription: Stripe.Subscription): Promise<SyncSubscriptionResult> {
        const customerId = getStripeCustomerId(stripeSubscription)

        const user = await this.prisma.user.findUnique({
            where: {
                stripeCustomerId: customerId,
            },
            select: {
                id: true,
                planId: true,
                subscription: true,
            },
        })

        if (!user) {
            // Lança erro para o Stripe reenviar o evento depois (o usuário pode ainda não ter sido gravado).
            throw new NotFoundException(
                messagesHelper.OBJECT_NOT_FOUND({
                    name: "User",
                    property: "stripeCustomerId",
                    value: customerId,
                }),
            )
        }

        const priceId = getStripeSubscriptionPriceId(stripeSubscription)

        const plan = await this.prisma.plan.findUnique({
            where: {
                externalPriceId: priceId,
            },
            select: {
                id: true,
            },
        })

        if (!plan) {
            throw new NotFoundException(
                messagesHelper.OBJECT_NOT_FOUND({
                    name: "Plan",
                    property: "externalPriceId",
                    value: priceId,
                }),
            )
        }

        const entitled = isSubscriptionEntitled(stripeSubscription.status)
        const currentSubscription = user.subscription
        const isCurrentSubscription = !currentSubscription || currentSubscription.externalId === stripeSubscription.id

        if (!isCurrentSubscription && !entitled) {
            // Eventos de uma assinatura antiga (ex.: cancelamento da assinatura gratuita após o upgrade)
            // ou de um checkout ainda não pago não devem alterar a assinatura vigente.
            return { ignored: true, userId: user.id }
        }

        const { currentPeriodStart, currentPeriodEnd } = getCurrentSubscriptionPeriods(stripeSubscription)

        const data = {
            status: stripeSubscription.status as SubscriptionStatus,
            externalId: stripeSubscription.id,
            itemId: getStripeSubscriptionItemId(stripeSubscription),
            currentPeriodStart: currentPeriodStart,
            currentPeriodEnd: currentPeriodEnd,
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            canceledAt: stripeSubscription.canceled_at ? new Date(stripeSubscription.canceled_at * 1000) : null,
            endedAt: stripeSubscription.ended_at ? new Date(stripeSubscription.ended_at * 1000) : null,
        }

        const isAdminPlan = user.planId === configHelper.plans.admin.id
        const planId = isAdminPlan ? user.planId : entitled ? plan.id : configHelper.plans.free.id

        await this.prisma.$transaction([
            this.prisma.subscription.upsert({
                where: {
                    userId: user.id,
                },
                create: {
                    ...data,
                    userId: user.id,
                },
                update: data,
            }),
            this.prisma.user.update({
                where: {
                    id: user.id,
                },
                data: {
                    planId: planId,
                },
            }),
        ])

        if (!isCurrentSubscription && currentSubscription) {
            // Upgrade via checkout gera uma nova assinatura; a anterior precisa ser cancelada
            // para o cliente não ficar com duas assinaturas.
            await this.safeCancelStripeSubscription(currentSubscription.externalId)
        }

        return { ignored: false, userId: user.id, planId: planId, status: stripeSubscription.status }
    }

    private async safeCancelStripeSubscription(subscriptionId: string) {
        try {
            await this.stripe.subscriptions.cancel(subscriptionId)
        } catch (error: any) {
            if (error?.code !== "resource_missing") {
                this.logger.error(`Failed to cancel previous Stripe subscription ${subscriptionId}`, error)
            }
        }
    }

    async createCheckoutSession(userId: string, planId: string) {
        const user = await this.prisma.user.findUnique({
            where: {
                id: userId,
            },
            select: {
                id: true,
                planId: true,
                stripeCustomerId: true,
                subscription: {
                    select: {
                        status: true,
                    },
                },
            },
        })

        if (!user) {
            throw new NotFoundException(
                messagesHelper.OBJECT_NOT_FOUND({
                    name: "User",
                    value: userId,
                }),
            )
        }

        if (!user.stripeCustomerId) {
            throw new BadRequestException(messagesHelper.STRIPE_CUSTOMER_NOT_FOUND)
        }

        if (planId === configHelper.plans.free.id || planId === configHelper.plans.admin.id) {
            throw new BadRequestException(messagesHelper.PLAN_NOT_PURCHASABLE)
        }

        const plan = await this.prisma.plan.findUnique({
            where: {
                id: planId,
            },
        })

        if (!plan) {
            throw new NotFoundException(
                messagesHelper.OBJECT_NOT_FOUND({
                    name: "Plan",
                    value: planId,
                }),
            )
        }

        const hasActivePaidPlan =
            user.planId !== configHelper.plans.free.id &&
            !!user.subscription &&
            isSubscriptionEntitled(user.subscription.status)

        if (hasActivePaidPlan) {
            // Troca entre planos pagos deve ser feita pelo portal de cobrança (com proração).
            throw new BadRequestException(messagesHelper.ALREADY_SUBSCRIBED_TO_PLAN)
        }

        const session = await this.stripe.checkout.sessions.create({
            mode: "subscription",
            customer: user.stripeCustomerId,
            client_reference_id: user.id,
            line_items: [
                {
                    price: plan.externalPriceId,
                    quantity: 1,
                },
            ],
            success_url: new URL(configHelper.frontend.checkoutSuccessPath, configHelper.frontend.url).toString(),
            cancel_url: new URL(configHelper.frontend.checkoutCancelPath, configHelper.frontend.url).toString(),
            metadata: {
                userId: user.id,
                planId: plan.id,
            },
            subscription_data: {
                metadata: {
                    userId: user.id,
                    planId: plan.id,
                },
            },
        })

        return {
            id: session.id,
            url: session.url,
        }
    }

    async createBillingPortalSession(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: {
                id: userId,
            },
            select: {
                stripeCustomerId: true,
            },
        })

        if (!user?.stripeCustomerId) {
            throw new BadRequestException(messagesHelper.STRIPE_CUSTOMER_NOT_FOUND)
        }

        const session = await this.stripe.billingPortal.sessions.create({
            customer: user.stripeCustomerId,
            return_url: new URL(configHelper.frontend.billingPortalReturnPath, configHelper.frontend.url).toString(),
        })

        return {
            url: session.url,
        }
    }
}
