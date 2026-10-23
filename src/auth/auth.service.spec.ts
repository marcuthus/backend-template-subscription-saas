import { BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"

import { configHelper } from "../helpers/config.helper"
import { AuthService } from "./auth.service"

const JWT_SECRET = "test-secret"

describe("AuthService", () => {
    let service: AuthService
    let jwtService: JwtService
    let usersService: Record<string, jest.Mock>
    let mailerService: { send: jest.Mock }
    let storedUser: Record<string, any>

    beforeEach(() => {
        storedUser = {
            id: "8c1b8f0e-8f5c-4a8e-9a3c-6f1f4f5f2b11",
            email: "user@email.com",
            username: "user",
            name: "User",
            role: "USER",
            password: "$2b$hash-1",
            apiKey: "encrypted",
        }

        jwtService = new JwtService({ secret: JWT_SECRET, signOptions: { expiresIn: "15m" } })

        usersService = {
            create: jest.fn().mockImplementation(async (dto) => ({ id: "new", ...dto })),
            findOne: jest.fn().mockImplementation(async () => storedUser),
            safeFindOneByEmail: jest
                .fn()
                .mockImplementation(async (email: string) => (email === storedUser.email ? storedUser : null)),
            resetPassword: jest.fn().mockImplementation(async () => {
                storedUser.password = "$2b$hash-2"
            }),
            safeFindOneByApiKey: jest.fn(),
        }

        mailerService = { send: jest.fn().mockResolvedValue(true) }

        const configService = {
            getOrThrow: jest.fn((key: string) => {
                const values: Record<string, string> = {
                    REFRESH_SIGN_EXPIRES_IN: "30d",
                    JWT_PRIVATE_KEY: JWT_SECRET,
                    BREVO_SENDER_EMAIL: "noreply@email.com",
                }
                return values[key]
            }),
        }

        service = new AuthService(
            {} as any,
            mailerService as any,
            usersService as any,
            jwtService,
            configService as any,
        )
    })

    describe("signUp", () => {
        const dto = {
            name: "User",
            username: "user",
            email: "user@email.com",
            password: "Senha@123",
        }

        it("cria o usuário no plano gratuito quando nenhum plano é enviado", async () => {
            await service.signUp(dto)
            expect(usersService.create).toHaveBeenCalledWith({ ...dto, planId: configHelper.plans.free.id })
        })

        it("não permite escolher um plano pago no cadastro (precisa de checkout)", async () => {
            await expect(service.signUp({ ...dto, planId: configHelper.plans.pro.id })).rejects.toBeInstanceOf(
                BadRequestException,
            )
            expect(usersService.create).not.toHaveBeenCalled()
        })

        it("não permite escolher o plano de admin", async () => {
            await expect(service.signUp({ ...dto, planId: configHelper.plans.admin.id })).rejects.toBeInstanceOf(
                NotFoundException,
            )
        })
    })

    describe("refreshToken", () => {
        it("gera novos tokens a partir de um refresh token válido", async () => {
            const { refreshToken } = await service.signIn(storedUser as any)
            const tokens = await service.refreshToken(storedUser.id, { refreshToken })
            expect(jwtService.verify(tokens.accessToken).type).toBe("access")
        })

        it("rejeita um access token usado como refresh token", async () => {
            const { accessToken } = await service.signIn(storedUser as any)
            await expect(service.refreshToken(storedUser.id, { refreshToken: accessToken })).rejects.toBeInstanceOf(
                UnauthorizedException,
            )
        })

        it("rejeita refresh token de outro usuário", async () => {
            const { refreshToken } = await service.signIn(storedUser as any)
            await expect(service.refreshToken("outro-id", { refreshToken })).rejects.toBeInstanceOf(
                UnauthorizedException,
            )
        })
    })

    describe("forgotPassword / resetPassword", () => {
        const getTokenFromEmail = () => {
            const html: string = mailerService.send.mock.calls[0][0].htmlContent
            const url = new URL(html.match(/href="([^"]+)"/)![1])
            expect(url.origin + url.pathname).toBe(
                new URL(configHelper.frontend.resetPasswordPath, configHelper.frontend.url).toString(),
            )
            return url.searchParams.get("token")!
        }

        it("envia um link real de reset e permite redefinir a senha", async () => {
            await service.forgotPassword({ email: storedUser.email })
            const token = getTokenFromEmail()

            await service.resetPassword({ token, password: "NovaSenha@123" })

            expect(usersService.resetPassword).toHaveBeenCalledWith(storedUser.email, "NovaSenha@123")
        })

        it("o token de reset só pode ser usado uma vez", async () => {
            await service.forgotPassword({ email: storedUser.email })
            const token = getTokenFromEmail()

            await service.resetPassword({ token, password: "NovaSenha@123" })

            await expect(service.resetPassword({ token, password: "Outra@1234" })).rejects.toBeInstanceOf(
                UnauthorizedException,
            )
        })

        it("não envia email para usuários inexistentes", async () => {
            await service.forgotPassword({ email: "naoexiste@email.com" })
            expect(mailerService.send).not.toHaveBeenCalled()
        })

        it("rejeita access/refresh tokens no reset de senha", async () => {
            const { accessToken, refreshToken } = await service.signIn(storedUser as any)

            await expect(service.resetPassword({ token: accessToken, password: "Senha@1234" })).rejects.toBeInstanceOf(
                UnauthorizedException,
            )
            await expect(service.resetPassword({ token: refreshToken, password: "Senha@1234" })).rejects.toBeInstanceOf(
                UnauthorizedException,
            )
        })

        it("rejeita um token de reset forjado com o segredo padrão", async () => {
            const forged = jwtService.sign({ sub: storedUser.email, type: "forgot_password" })

            await expect(service.resetPassword({ token: forged, password: "Senha@1234" })).rejects.toBeInstanceOf(
                UnauthorizedException,
            )
        })
    })

    describe("validateApiKey", () => {
        it("não expõe senha nem a chave criptografada", async () => {
            usersService.safeFindOneByApiKey.mockResolvedValue(storedUser)
            const user = await service.validateApiKey("dev_key")
            expect(user).not.toHaveProperty("password")
            expect(user).not.toHaveProperty("apiKey")
        })

        it("retorna null para chave inexistente", async () => {
            usersService.safeFindOneByApiKey.mockResolvedValue(null)
            await expect(service.validateApiKey("dev_key")).resolves.toBeNull()
        })
    })
})
