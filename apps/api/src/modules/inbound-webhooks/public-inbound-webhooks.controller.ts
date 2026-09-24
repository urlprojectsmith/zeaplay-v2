import { Controller, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { InboundWebhookPublicParamDto } from './dto/inbound-webhook.dto';
import { InboundWebhooksService } from './inbound-webhooks.service';

@ApiTags('public inbound webhooks')
@Controller('inbound')
export class PublicInboundWebhooksController {
  constructor(private readonly inboundWebhooks: InboundWebhooksService) {}

  @Post(':publicId')
  receive(@Param() params: InboundWebhookPublicParamDto, @Req() request: Request) {
    const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    return this.inboundWebhooks.receive(params.publicId, request.headers, rawBody);
  }
}
