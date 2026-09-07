import { Injectable, NotImplementedException } from '@nestjs/common';

export interface BroadcastDto {
  message: string;
}

@Injectable()
export class OwnerService {
  stats() {
    // TODO(milestone 6): passes issued, stamps this week, vouchers redeemed.
    throw new NotImplementedException('stats');
  }

  broadcast(body: BroadcastDto) {
    // TODO(milestone 6): lock-screen push to all of this cafe's passes.
    throw new NotImplementedException(`broadcast(${body.message.length} chars)`);
  }
}
