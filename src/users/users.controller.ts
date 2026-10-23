import { Controller, Get, Post, Body, Patch, Delete, UseGuards } from "@nestjs/common"

import { OwnershipGuardFactory } from "../common/factories/ownership-guard.factory"
import { ApiPaginated } from "../common/decorators/api-paginated.decorator"
import { PerPage } from "../common/decorators/per-page.decorator"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { Page } from "../common/decorators/page.decorator"
import { Roles } from "../auth/decorators/roles.decorator"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Id } from "../common/decorators/id.decorator"
import { UpdateUserDto } from "./dto/update-user.dto"
import { CreateUserDto } from "./dto/create-user.dto"
import { UserRole } from "../generated/prisma/enums"
import { UsersService } from "./users.service"

@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Post()
    @Roles(UserRole.ADMIN)
    async create(@Body() createUserDto: CreateUserDto) {
        return await this.usersService.create(createUserDto)
    }

    @Get()
    @Roles(UserRole.ADMIN)
    @ApiPaginated()
    async findAll(@Page() page: number, @PerPage() perPage: number) {
        return await this.usersService.findAll({
            page: page,
            perPage: perPage,
        })
    }

    @Get(":id")
    @UseGuards(OwnershipGuardFactory("id"))
    async findOne(@Id() id: string) {
        return await this.usersService.findOne(id)
    }

    @Patch(":id")
    @UseGuards(OwnershipGuardFactory("id"))
    async update(@Id() id: string, @Body() updateUserDto: UpdateUserDto) {
        return await this.usersService.update(id, updateUserDto)
    }

    @Delete(":id")
    @Roles(UserRole.ADMIN)
    async remove(@Id() id: string) {
        return await this.usersService.remove(id)
    }
}
