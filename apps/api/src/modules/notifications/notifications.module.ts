import { Module } from '@nestjs/common';
import { MailModule } from '../../infrastructure/mail/mail.module';
import { NotificationsController } from './notifications.controller';
import {
  NotificationEmailDeliveryService,
  NotificationEmailProcessor,
} from './notification-email-delivery.service';
import { NotificationReminderSchedulerService } from './notification-reminder-scheduler.service';
import {
  NotificationReminderProcessor,
  NotificationReminderService,
} from './notification-reminder.service';
import { NotificationRouterService } from './notification-router.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [MailModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationRouterService,
    NotificationEmailDeliveryService,
    NotificationEmailProcessor,
    NotificationReminderService,
    NotificationReminderProcessor,
    NotificationReminderSchedulerService,
  ],
  exports: [NotificationsService, NotificationRouterService, NotificationReminderService],
})
export class NotificationsModule {}
