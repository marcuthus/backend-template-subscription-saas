import { forwardRef, Module } from "@nestjs/common"
import { PassportModule } from "@nestjs/passport"
import { ConfigService } from "@nestjs/config"
import { JwtModule } from "@nestjs/jwt"

import type { StringValue } from "ms"

import { JwtRefreshTokenStrategy } from "./strategies/jwt-refresh-token.strategy"
import { ApiKeyStrategy } from "./strategies/api-key.strategy"
import { LocalStrategy } from "./strategies/local.strategy"
import { JwtStrategy } from "./strategies/jwt.strategy"
import { MailerModule } from "../mailer/mailer.module"
import { UsersModule } from "../users/users.module"
import { AuthController } from "./auth.controller"
import { AuthService } from "./auth.service"

@Module({
    imports: [
        MailerModule,
        PassportModule,
        forwardRef(() => UsersModule),
        JwtModule.registerAsync({
            useFactory: (configService: ConfigService) => ({
                // "secret" é usado tanto para assinar quanto para verificar (HS256). Com "privateKey" o verify() falhava.
                secret: configService.getOrThrow<string>("JWT_PRIVATE_KEY"),
                signOptions: { expiresIn: configService.getOrThrow<StringValue>("ACCESS_SIGN_EXPIRES_IN") },
            }),
            inject: [ConfigService],
        }),
    ],
    providers: [AuthService, LocalStrategy, JwtStrategy, ApiKeyStrategy, JwtRefreshTokenStrategy],
    controllers: [AuthController],
    exports: [AuthService],
})
export class AuthModule {}
