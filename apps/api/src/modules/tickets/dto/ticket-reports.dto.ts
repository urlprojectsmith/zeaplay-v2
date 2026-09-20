import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TicketQueryDto } from './ticket-query.dto';

export const ticketReportBuckets = ['DAY', 'WEEK', 'MONTH'] as const;
export type TicketReportBucket = (typeof ticketReportBuckets)[number];

export class TicketReportQueryDto extends TicketQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  trendFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  trendTo?: string;

  @ApiPropertyOptional({ enum: ticketReportBuckets, default: 'DAY' })
  @IsOptional()
  @IsIn(ticketReportBuckets)
  bucket: TicketReportBucket = 'DAY';
}
