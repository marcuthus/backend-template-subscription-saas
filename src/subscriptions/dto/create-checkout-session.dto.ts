import { ApiProperty } from "@nestjs/swagger"
import { IsUUID } from "class-validator"

export class CreateCheckoutSessionDto {
    @ApiProperty()
    @IsUUID()
    planId: string
}
