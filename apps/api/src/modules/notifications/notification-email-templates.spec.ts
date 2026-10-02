import { renderNotificationEmailTemplate } from './notification-email-templates';

describe('notification email branding', () => {
  it('escapes branded text and preserves trusted action origins', () => {
    const rendered = renderNotificationEmailTemplate(
      'task.assigned',
      {
        taskTitle: '<Launch>',
        entityId: '11111111-1111-4111-8111-111111111111',
      },
      'https://play.zeacrm.com',
      {
        appName: 'Tenant <Portal>',
        companyName: 'Tenant Co',
        primaryColor: '#123456',
        accentColor: '#654321',
        footerText: 'Tenant footer <script>',
        supportEmail: 'support@tenant.test',
        supportUrl: 'https://support.tenant.test/help',
      },
    );

    expect(rendered.subject).toBe('ZeaPlay: Task assigned');
    expect(rendered.text).toContain('Open in ZeaPlay: https://play.zeacrm.com/notifications/');
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;Launch&gt;');
    expect(rendered.html).toContain('https://support.tenant.test/help');
  });
});
