import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common"
import { SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js"
import { ConfigService } from "@nestjs/config"
import { JwtService } from "@nestjs/jwt"
import * as bcrypt from "bcrypt"

import type { StringValue } from "ms"

import { JwtAccessPayload, JwtForgotPasswordPayload, JwtRefreshPayload } from "./interfaces/jwt-payload.interface"
import { InjectSupabaseClient } from "../supabase/inject-supabase-client.decorator"
import { SignUpWithSupabaseDto } from "./dto/signup-with-supabase.dto"
import { SignInWithSupabaseDto } from "./dto/signin-with-supabase.dto"
import { UserWithoutSensitiveInfo } from "../users/users.types"
import { generateUsername } from "../utils/generate-username"
import { ForgotPasswordDto } from "./dto/forgot-password.dto"
import { messagesHelper } from "../helpers/messages.helper"
import { ResetPasswordDto } from "./dto/reset-password.dto"
import { RefreshTokenDto } from "./dto/refresh-token.dto"
import { MailerService } from "../mailer/mailer.service"
import { configHelper } from "../helpers/config.helper"
import { UsersService } from "../users/users.service"
import { User } from "../generated/prisma/client"
import { SignUpDto } from "./dto/sign-up.dto"

type TokenUser = Pick<User, "id" | "email" | "username" | "role" | "name">

@Injectable()
export class AuthService {
    private readonly refreshSignExpiresIn: StringValue

    constructor(
        @InjectSupabaseClient() private readonly supabase: SupabaseClient,
        private readonly mailerService: MailerService,
        private readonly usersService: UsersService,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
    ) {
        this.refreshSignExpiresIn = configService.getOrThrow<StringValue>("REFRESH_SIGN_EXPIRES_IN")
    }

    private generateTokens(user: TokenUser) {
        const accessPayload = {
            sub: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            name: user.name,
            type: "access",
        } satisfies JwtAccessPayload

        const refreshPayload = {
            sub: user.id,
            type: "refresh",
        } satisfies JwtRefreshPayload

        return {
            accessToken: this.jwtService.sign(accessPayload),
            refreshToken: this.jwtService.sign(refreshPayload, {
                expiresIn: this.refreshSignExpiresIn,
            }),
        }
    }

    /**
     * O token de reset de senha é assinado com um segredo derivado do hash da senha atual,
     * então ele deixa de ser válido assim que a senha é alterada (uso único).
     */
    private getResetPasswordSecret(user: Pick<User, "password">) {
        return `${this.configService.getOrThrow<string>("JWT_PRIVATE_KEY")}:${user.password ?? ""}`
    }

    /**
     * No cadastro só é permitido o plano gratuito. Planos pagos precisam passar pelo
     * checkout do Stripe (POST /subscriptions/checkout) para que o pagamento seja garantido.
     */
    private resolveSignUpPlanId(planId?: string) {
        if (planId === configHelper.plans.admin.id) {
            throw new NotFoundException(
                messagesHelper.OBJECT_NOT_FOUND({
                    name: "Plan",
                    property: "id",
                    value: planId,
                }),
            )
        }

        if (planId && planId !== configHelper.plans.free.id) {
            throw new BadRequestException(messagesHelper.PAID_PLAN_REQUIRES_CHECKOUT)
        }

        return configHelper.plans.free.id
    }

    async signIn(user: User) {
        return this.generateTokens(user)
    }

    async signUp(signUpDto: SignUpDto) {
        const planId = this.resolveSignUpPlanId(signUpDto.planId)
        return await this.usersService.create({ ...signUpDto, planId: planId })
    }

    async signInWithSupabase(loginWithSupabaseDto: SignInWithSupabaseDto) {
        const { id: supabaseId, email } = await this.verifySupabaseToken(loginWithSupabaseDto.token)

        const foundUserBySubaseId = await this.usersService.safeFindOneBySupabaseId(supabaseId)
        const foundUserByEmail = email ? await this.usersService.safeFindOneByEmail(email) : null

        const user = foundUserBySubaseId || foundUserByEmail

        if (!user) {
            throw new NotFoundException(
                messagesHelper.OBJECT_NOT_FOUND({
                    name: "User",
                    property: "supabaseId",
                    value: supabaseId,
                }),
            )
        }

        return this.generateTokens(user)
    }

    private async checkIfUserExistsForSupabaseSignUp(supabaseId: string, email: string): Promise<void> {
        const foundUserBySubaseId = await this.usersService.safeFindOneBySupabaseId(supabaseId)
        const foundUserByEmail = await this.usersService.safeFindOneByEmail(email)
        const existingUser = foundUserBySubaseId || foundUserByEmail

        if (existingUser) {
            throw new BadRequestException(messagesHelper.OAUTH_ACCOUNT_ALREADY_EXISTS)
        }
    }

    async signUpWithSupabase(signUpWithSupabaseDto: SignUpWithSupabaseDto) {
        const {
            id: supabaseId,
            email,
            user_metadata: metadata,
        } = await this.verifySupabaseToken(signUpWithSupabaseDto.token)

        if (!email) {
            throw new BadRequestException(messagesHelper.OAUTH_ACCOUNT_WITHOUT_EMAIL)
        }

        const planId = this.resolveSignUpPlanId(signUpWithSupabaseDto.planId)

        await this.checkIfUserExistsForSupabaseSignUp(supabaseId, email)

        const userName = metadata?.name ?? signUpWithSupabaseDto.name ?? "Unknown User"
        const generatedUsername = generateUsername(userName)

        return await this.usersService.create({
            email: email,
            name: userName,
            supabaseId: supabaseId,
            planId: planId,
            username: generatedUsername,
        })
    }

    async refreshToken(userId: string, { refreshToken }: RefreshTokenDto) {
        let payload: JwtRefreshPayload

        try {
            payload = this.jwtService.verify<JwtRefreshPayload>(refreshToken)
        } catch (error) {
            throw new UnauthorizedException(messagesHelper.INVALID_AUTHORIZATION_TOKEN)
        }

        if (payload.type !== "refresh" || payload.sub !== userId) {
            throw new UnauthorizedException(messagesHelper.INVALID_AUTHORIZATION_TOKEN)
        }

        let user: TokenUser

        try {
            user = await this.usersService.findOne(payload.sub)
        } catch (error) {
            throw new UnauthorizedException(messagesHelper.INVALID_AUTHORIZATION_TOKEN)
        }

        return this.generateTokens(user)
    }

    async forgotPassword({ email }: ForgotPasswordDto) {
        const user = await this.usersService.safeFindOneByEmail(email)

        if (!user) return

        const payload = {
            sub: user.email,
            type: "forgot_password",
        } satisfies JwtForgotPasswordPayload

        const token = this.jwtService.sign(payload, {
            expiresIn: "1h",
            secret: this.getResetPasswordSecret(user),
        })

        const resetUrl = new URL(configHelper.frontend.resetPasswordPath, configHelper.frontend.url)
        resetUrl.searchParams.set("token", token)

        await this.mailerService.send({
            to: user.email,
            subject: "Redefinição de senha",
            senderEmail: this.configService.getOrThrow<string>("BREVO_SENDER_EMAIL"),
            htmlContent: `<p>Clique <a href="${resetUrl.toString()}">aqui</a> para redefinir sua senha. O link expira em 1 hora.</p>`,
        })
    }

    async resetPassword(resetPasswordDto: ResetPasswordDto) {
        const decoded = this.jwtService.decode<JwtForgotPasswordPayload | null>(resetPasswordDto.token)

        if (!decoded || decoded.type !== "forgot_password" || typeof decoded.sub !== "string") {
            throw new UnauthorizedException(messagesHelper.INVALID_AUTHORIZATION_TOKEN)
        }

        const user = await this.usersService.safeFindOneByEmail(decoded.sub)

        if (!user) {
            throw new UnauthorizedException(messagesHelper.INVALID_AUTHORIZATION_TOKEN)
        }

        try {
            this.jwtService.verify<JwtForgotPasswordPayload>(resetPasswordDto.token, {
                secret: this.getResetPasswordSecret(user),
            })
        } catch (error) {
            throw new UnauthorizedException(messagesHelper.INVALID_AUTHORIZATION_TOKEN)
        }

        await this.usersService.resetPassword(user.email, resetPasswordDto.password)
    }

    async validateUser(email: string, password: string): Promise<UserWithoutSensitiveInfo | null> {
        let user: User

        try {
            user = await this.usersService.findOneByEmail(email)
        } catch (error) {
            return null
        }

        if (!user.password) {
            throw new BadRequestException(messagesHelper.OAUTH_ACCOUNT_WITHOUT_PASSWORD)
        }

        const isValidPassword = await bcrypt.compare(password, user.password)

        if (!isValidPassword) {
            return null
        }

        const { password: _, apiKey: __, ...rest } = user

        return rest
    }

    async verifySupabaseToken(token: string): Promise<SupabaseUser> {
        const { data, error } = await this.supabase.auth.getUser(token)

        if (error || !data.user) {
            throw new UnauthorizedException(messagesHelper.INVALID_SUPABASE_AUTH_TOKEN)
        }

        return data.user
    }

    async validateApiKey(apiKey: string) {
        const user = await this.usersService.safeFindOneByApiKey(apiKey)

        if (!user) {
            return null
        }

        const { password: _, apiKey: __, ...rest } = user

        return rest
    }
}
