import { InternalServerErrorException } from "@nestjs/common"
import Stripe from "stripe"

import { messagesHelper } from "../helpers/messages.helper"

export function getStripeSubscriptionItemId(subscription: Stripe.Subscription) {
    const subscriptionItemId = subscription.items.data[0]?.id

    if (!subscriptionItemId) {
        throw new InternalServerErrorException(messagesHelper.STRIPE_ITEM_ID_NOT_FOUND_IN_SUBSCRIPTION)
    }

    return subscriptionItemId
}
