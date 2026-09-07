import { Controller, Delete, Get, NotImplementedException, Param, Post } from '@nestjs/common';

// Apple PassKit web service spec (milestone 4):
// https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes
@Controller('passkit/v1')
export class PasskitController {
  @Post('devices/:deviceId/registrations/:passTypeId/:serial')
  register(@Param('deviceId') deviceId: string, @Param('serial') serial: string) {
    throw new NotImplementedException(`register ${deviceId} for ${serial}`);
  }

  @Delete('devices/:deviceId/registrations/:passTypeId/:serial')
  unregister(@Param('deviceId') deviceId: string, @Param('serial') serial: string) {
    throw new NotImplementedException(`unregister ${deviceId} for ${serial}`);
  }

  @Get('devices/:deviceId/registrations/:passTypeId')
  updatablePasses(@Param('deviceId') deviceId: string) {
    throw new NotImplementedException(`updatablePasses for ${deviceId}`);
  }

  @Get('passes/:passTypeId/:serial')
  latestPass(@Param('serial') serial: string) {
    throw new NotImplementedException(`latestPass ${serial}`);
  }

  @Post('log')
  log() {
    return {};
  }
}
