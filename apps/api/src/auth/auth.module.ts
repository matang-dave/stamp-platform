import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

// Global (like DbModule) so StaffGuard — instantiated per-controller by
// @UseGuards — can resolve JwtService in any feature module without each
// module importing AuthModule explicitly.
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      // registerAsync: read JWT_SECRET at bootstrap, not at import time
      // (specs load .env after modules are imported).
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: '12h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
