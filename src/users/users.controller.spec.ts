import { Test, TestingModule } from "@nestjs/testing"

import { RESOURCE_SERVICE_KEY } from "../common/guards/ownership.guard"
import { ROLES_KEY } from "../auth/decorators/roles.decorator"
import { UserRole } from "../generated/prisma/enums"

import { UsersController } from "./users.controller"
import { UsersService } from "./users.service"

describe("UsersController", () => {
    let controller: UsersController

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UsersController],
            providers: [
                { provide: UsersService, useValue: {} },
                { provide: RESOURCE_SERVICE_KEY, useValue: {} },
            ],
        }).compile()

        controller = module.get<UsersController>(UsersController)
    })

    it("should be defined", () => {
        expect(controller).toBeDefined()
    })

    it("apenas admins podem criar usuários diretamente", () => {
        expect(Reflect.getMetadata(ROLES_KEY, UsersController.prototype.create)).toEqual([UserRole.ADMIN])
    })
})
