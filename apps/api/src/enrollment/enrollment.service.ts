import { Injectable, NotImplementedException } from '@nestjs/common';

export interface EnrollDto {
  platform: 'apple' | 'google';
  email?: string;
  // Marketing consent must be an explicit, unbundled opt-in (GDPR Art. 7).
  marketingConsent?: boolean;
}

@Injectable()
export class EnrollmentService {
  getCafeBySlug(slug: string) {
    // TODO(milestone 1): look up active cafe, return branding for the enrollment page.
    throw new NotImplementedException(`getCafeBySlug(${slug})`);
  }

  enroll(slug: string, body: EnrollDto) {
    // TODO(milestone 1): create pass row + enroll event.
    // TODO(milestone 3/4): return wallet pass (Google JWT save link / Apple .pkpass).
    throw new NotImplementedException(`enroll(${slug}, ${body.platform})`);
  }
}
