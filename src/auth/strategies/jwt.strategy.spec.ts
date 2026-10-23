import { UnauthorizedException } from "@nestjs/common"

import { JwtStrategy } from "./jwt.strategy"

describe("JwtStrategy", () => {
    const strategy = new JwtStrategy({ getOrThrow: () => "secret" } as any)

    it("aceita access tokens", () => {
        expect(
            strategy.validate({
                sub: "id",
                email: "user@email.com",
                role: "USER",
                username: "user",
                name: "User",
                type: "access",
            }),
        ).toEqual({ id: "id", email: "user@email.com", role: "USER" })
    })

    it("rejeita refresh tokens e tokens de reset de senha", () => {
        expect(() => strategy.validate({ sub: "id", type: "refresh" } as any)).toThrow(UnauthorizedException)
        expect(() => strategy.validate({ sub: "a@b.com", type: "forgot_password" } as any)).toThrow(
            UnauthorizedException,
        )
    })
})
