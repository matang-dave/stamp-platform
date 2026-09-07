import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { LoginDto } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }
}
