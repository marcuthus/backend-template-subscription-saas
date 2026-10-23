import { SubscriptionStatus } from "../../generated/prisma/enums"

export class UpdateSubscriptionDto {
    status?: SubscriptionStatus
    externalId?: string
    itemId?: string
    currentPeriodStart?: Date
    currentPeriodEnd?: Date
    cancelAtPeriodEnd?: boolean
    canceledAt?: Date | null
    endedAt?: Date | null
}
