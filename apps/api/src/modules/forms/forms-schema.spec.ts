import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');
const schema = read('prisma/schema.prisma');
const migrationDirs = readdirSync(join(root, 'prisma/migrations')).sort();
const migration = read('prisma/migrations/0082_phase16_2_forms_foundation/migration.sql');
const service = read('src/modules/forms/forms.service.ts');
const assetsService = read('src/modules/assets/assets.service.ts');
const controller = read('src/modules/forms/forms.controller.ts');
const captcha = read('src/modules/forms/forms-captcha.service.ts');
const matrix = read('src/modules/billing/phase15-3-feature-enforcement.matrix.ts');

describe('Phase 16.2 Forms schema and architecture gate', () => {
  it('adds a single 0082 Forms foundation migration after the certified 0081 Docs baseline', () => {
    expect(migrationDirs).toContain('0081_phase16_1_docs_foundation');
    expect(migrationDirs).toContain('0082_phase16_2_forms_foundation');
    expect(migrationDirs.indexOf('0082_phase16_2_forms_foundation')).toBe(
      migrationDirs.indexOf('0081_phase16_1_docs_foundation') + 1,
    );
    expect(migration).toContain('CREATE TABLE "forms"');
    expect(migration).toContain('CREATE TABLE "form_versions"');
    expect(migration).toContain('CREATE TABLE "form_submissions"');
    expect(migration).toContain('CREATE TABLE "form_submission_assets"');
  });

  it('models Workspace-owned Forms, immutable versions, submissions, and Asset-backed files', () => {
    expect(schema).toContain('model Form {');
    expect(schema).toContain('workspaceId            String');
    expect(schema).toContain('model FormVersion {');
    expect(schema).toContain('versionNumber           Int');
    expect(schema).toContain('model FormSubmission {');
    expect(schema).toContain('answers                 Json');
    expect(schema).toContain('model FormSubmissionAsset {');
    expect(schema).toContain('asset          Asset');
    expect(schema).toContain('forms                               Form[]');
  });

  it('extends the existing automation event model instead of creating a second engine', () => {
    expect(schema).toContain('FORM_SUBMITTED');
    expect(schema).toContain('FORM_SUBMISSION');
    expect(service).toContain('AutomationDomainEventsService');
    expect(service).toContain('AutomationTriggerType.FORM_SUBMITTED');
    expect(service).not.toContain('new Queue');
  });

  it('documents Forms as not commercially gated while retaining restricted-mode boundaries', () => {
    expect(matrix).toContain("'FORMS'");
    expect(matrix).toContain("'WorkspaceFormsController'");
    expect(matrix).toContain("'PublicFormsController'");
    expect(matrix).toContain('no current Phase 15.3 Forms catalog key');
    expect(service).toContain('FORM_UNAVAILABLE');
  });

  it('keeps public submission defenses server-side', () => {
    expect(service).toContain('FORM_CONDITION_CYCLE');
    expect(service).toContain('FORM_UNKNOWN_FIELD');
    expect(service).toContain('FORM_REDIRECT_UNSAFE');
    expect(service).toContain('FORM_SPAM_REJECTED');
    expect(captcha).toContain('FORM_CAPTCHA_PROVIDER_UNAVAILABLE');
    expect(service).toContain('idempotencyKeyHash');
  });

  it('authorizes public upload through the existing Asset reservation flow', () => {
    expect(controller).toContain("@Post('uploads/authorize')");
    expect(controller).toContain("@Post('uploads/complete')");
    expect(service).toContain('authorizePublicUpload');
    expect(service).toContain('completePublicUpload');
    expect(service).toContain('FORM_VERSION_CHANGED');
    expect(service).toContain('FORM_UPLOAD_FIELD_INVALID');
    expect(service).toContain('consumePublicUploadAssets');
    expect(assetsService).toContain('authorizePublicFormUpload');
    expect(assetsService).toContain('completePublicFormUpload');
    expect(assetsService).toContain('storageUploadReservation.create');
    expect(assetsService).toContain('assertQuotaAvailable');
    expect(assetsService).toContain('publicFormUpload');
    expect(assetsService).toContain('uploadTokenHash');
    expect(assetsService).toContain('buildPublicFormStorageKey');
  });

  it('binds public Asset IDs to form, version, field, token, and workspace before submission linking', () => {
    expect(service).toContain('metadata.formPublicId !== context.formPublicId');
    expect(service).toContain('metadata.formVersionId !== context.formVersionId');
    expect(service).toContain('metadata.formVersionNumber !== context.formVersionNumber');
    expect(service).toContain('metadata.fieldId !== asset.fieldId');
    expect(service).toContain("metadata.uploadTokenHash !== hash(asset.uploadToken ?? '')");
    expect(service).toContain('FORM_ASSET_INVALID');
    expect(service).toContain('new Set(assetIds).size !== assetIds.length');
    expect(assetsService).toContain('FORM_UPLOAD_COUNT_EXCEEDED');
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
