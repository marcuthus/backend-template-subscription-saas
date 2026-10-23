import Stripe from "stripe"

/**
 * Status de assinatura do Stripe que dão direito ao plano contratado.
 * Qualquer outro status (incomplete, past_due, unpaid, canceled, paused...) não libera o plano pago.
 */
const ENTITLED_STATUSES: Stripe.Subscription.Status[] = ["active", "trialing"]

export function isSubscriptionEntitled(status: Stripe.Subscription.Status | string) {
    return ENTITLED_STATUSES.includes(status as Stripe.Subscription.Status)
}
