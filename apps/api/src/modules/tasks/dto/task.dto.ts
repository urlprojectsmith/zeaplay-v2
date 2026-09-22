import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TaskCommentReactionType,
  TaskCommentVisibility,
  TaskCompletionApproverMode,
  TaskCompletionDecision,
  TaskCompletionProofRequirementMode,
  TaskCompletionProofType,
  TaskTimeEntryType,
  TaskPriority,
  TaskRecurrenceCustomUnit,
  TaskRecurrenceEndMode,
  TaskRecurrenceFrequency,
  TaskTemplateStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import type { RecurrenceScheduleInput } from '../task-recurrence-schedule';
import {
  ArrayUnique,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class TaskParamsDto {
  @ApiProperty()
  @IsUUID()
  workspaceId!: string;

  @ApiProperty()
  @IsUUID()
  taskId!: string;
}

export class TaskCommentParamsDto extends TaskParamsDto {
  @ApiProperty()
  @IsUUID()
  commentId!: string;
}

export class TaskAttachmentParamsDto extends TaskParamsDto {
  @ApiProperty()
  @IsUUID()
  attachmentId!: string;
}

export class TaskQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'updatedAt', 'dueAt', 'title', 'priority', 'kanbanRank'],
  })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'dueAt', 'title', 'priority', 'kanbanRank'])
  sortBy: 'createdAt' | 'updatedAt' | 'dueAt' | 'title' | 'priority' | 'kanbanRank' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeMembershipId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tagId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  createdById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueTo?: string;
}

export class CreateTaskDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: TaskPriority, default: TaskPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedStartAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 100000 })
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? null : Number(value),
  )
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  estimatedMinutes?: number | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  assigneeMembershipIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  followerMembershipIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  projectIds?: string[];

  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tagIds?: string[];

  @ApiPropertyOptional({ type: () => CreateTaskRecurrenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateTaskRecurrenceDto)
  recurrence?: RecurrenceScheduleInput;
}

export class RecurrenceScheduleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @ApiProperty({ enum: TaskRecurrenceFrequency })
  @IsEnum(TaskRecurrenceFrequency)
  frequency!: TaskRecurrenceFrequency;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 366 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  interval = 1;

  @ApiPropertyOptional({ enum: TaskRecurrenceCustomUnit, nullable: true })
  @IsOptional()
  @IsEnum(TaskRecurrenceCustomUnit)
  customIntervalUnit?: TaskRecurrenceCustomUnit | null;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startLocalDate!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  localTime!: string;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  selectedWeekdays?: number[];

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  monthlyDay?: number | null;

  @ApiProperty({ enum: TaskRecurrenceEndMode })
  @IsEnum(TaskRecurrenceEndMode)
  endMode!: TaskRecurrenceEndMode;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  untilLocalDate?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxOccurrences?: number | null;
}

export class CreateTaskRecurrenceDto extends RecurrenceScheduleDto {}

export class UpdateTaskRecurrenceDto extends RecurrenceScheduleDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 100000 })
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? null : Number(value),
  )
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  estimatedMinutes?: number | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  assigneeMembershipIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  followerMembershipIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  projectIds?: string[];

  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tagIds?: string[];
}

export class TaskRecurrenceQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAUSED', 'ENDED', 'ERROR'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED', 'ENDED', 'ERROR'])
  status?: 'ACTIVE' | 'PAUSED' | 'ENDED' | 'ERROR';

  @ApiPropertyOptional({ enum: ['createdAt', 'nextOccurrenceAt', 'updatedAt'] })
  @IsOptional()
  @IsIn(['createdAt', 'nextOccurrenceAt', 'updatedAt'])
  sortBy: 'createdAt' | 'nextOccurrenceAt' | 'updatedAt' = 'createdAt';
}

export class CreateTaskTemplateDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ minLength: 1, maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 100000 })
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? null : Number(value),
  )
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  estimatedMinutes?: number | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  assigneeMembershipIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  followerMembershipIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  projectIds?: string[];

  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tagIds?: string[];
}

export class UpdateTaskTemplateDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 100000 })
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? null : Number(value),
  )
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  estimatedMinutes?: number | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  assigneeMembershipIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  followerMembershipIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  projectIds?: string[];

  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tagIds?: string[];
}

export class TaskTemplateQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ enum: TaskTemplateStatus })
  @IsOptional()
  @IsEnum(TaskTemplateStatus)
  status?: TaskTemplateStatus;

  @ApiPropertyOptional({ enum: ['createdAt', 'updatedAt', 'name'] })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'name'])
  sortBy: 'createdAt' | 'updatedAt' | 'name' = 'createdAt';
}

export class CreateTaskFromTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 100000 })
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? null : Number(value),
  )
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  estimatedMinutes?: number | null;
}

export class SaveTaskAsTemplateDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class CreateTaskCommentDto {
  @ApiProperty({ minLength: 1, maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional({ enum: TaskCommentVisibility, default: TaskCommentVisibility.NORMAL })
  @IsOptional()
  @IsEnum(TaskCommentVisibility)
  visibility?: TaskCommentVisibility;

  @ApiPropertyOptional({ type: [String], maxItems: 100 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  mentionedMembershipIds?: string[];
}

export class UpdateTaskCommentDto {
  @ApiProperty({ minLength: 1, maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

export class TaskCommentReactionDto {
  @ApiProperty({ enum: TaskCommentReactionType })
  @IsEnum(TaskCommentReactionType)
  reactionType!: TaskCommentReactionType;
}

export class TaskTagIdsDto {
  @ApiProperty({ type: [String], maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tagIds!: string[];
}

export class TaskAttachmentIdsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  attachmentIds!: string[];
}

export class CreateTaskUrlAttachmentDto {
  @ApiProperty({ maxLength: 2048 })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;
}

export class UpdateTaskDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  plannedStartAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 100000 })
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? null : Number(value),
  )
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  estimatedMinutes?: number | null;

  @ApiPropertyOptional({
    enum: ['THIS_OCCURRENCE', 'THIS_AND_FUTURE', 'ENTIRE_SERIES'],
  })
  @IsOptional()
  @IsIn(['THIS_OCCURRENCE', 'THIS_AND_FUTURE', 'ENTIRE_SERIES'])
  recurrenceEditScope?: 'THIS_OCCURRENCE' | 'THIS_AND_FUTURE' | 'ENTIRE_SERIES';
}

export class CompletionProofItemDto {
  @ApiProperty({ enum: TaskCompletionProofType })
  @IsEnum(TaskCompletionProofType)
  type!: TaskCompletionProofType;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  textValue?: string;

  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  checklistConfirmed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  attachmentId?: string;
}

export class SubmitTaskCompletionDto {
  @ApiPropertyOptional({ type: [CompletionProofItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CompletionProofItemDto)
  proofItems?: CompletionProofItemDto[];
}

export class UpdateTaskStatusDto {
  @ApiProperty()
  @IsUUID()
  statusDefinitionId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional({ type: () => SubmitTaskCompletionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SubmitTaskCompletionDto)
  completion?: SubmitTaskCompletionDto;
}

export class TaskKanbanMoveDto {
  @ApiProperty()
  @IsUUID()
  statusDefinitionId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  beforeTaskId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  afterTaskId?: string | null;

  @ApiPropertyOptional({ type: () => SubmitTaskCompletionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SubmitTaskCompletionDto)
  completion?: SubmitTaskCompletionDto;
}

export class TaskKanbanColumnParamsDto {
  @ApiProperty()
  @IsUUID()
  workspaceId!: string;

  @ApiProperty()
  @IsUUID()
  statusDefinitionId!: string;
}

export class UpdateTaskKanbanColumnSettingDto {
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 999 })
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? null : Number(value),
  )
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(1)
  @Max(999)
  wipLimit?: number | null;
}

export class UpdateTaskParentDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  parentTaskId!: string | null;
}

export class TaskRelationshipIdsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  taskIds!: string[];
}

export class BulkTaskIdsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  taskIds!: string[];
}

export class BulkTaskStatusDto extends BulkTaskIdsDto {
  @ApiProperty()
  @IsUUID()
  statusDefinitionId!: string;
}

export class CompletionPolicyDto {
  @ApiProperty({ enum: TaskCompletionProofRequirementMode })
  @IsEnum(TaskCompletionProofRequirementMode)
  proofRequirementMode!: TaskCompletionProofRequirementMode;

  @ApiPropertyOptional({ enum: TaskCompletionProofType, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(TaskCompletionProofType, { each: true })
  requiredProofTypes?: TaskCompletionProofType[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;

  @ApiPropertyOptional({ enum: TaskCompletionApproverMode, nullable: true })
  @IsOptional()
  @IsEnum(TaskCompletionApproverMode)
  approverMode?: TaskCompletionApproverMode | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includeTaskCreator?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includePermissionApprovers?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includeProjectOwnersManagers?: boolean;

  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  explicitApproverMembershipIds?: string[];

  @ApiPropertyOptional({
    enum: ['THIS_OCCURRENCE', 'THIS_AND_FUTURE', 'ENTIRE_SERIES'],
  })
  @IsOptional()
  @IsIn(['THIS_OCCURRENCE', 'THIS_AND_FUTURE', 'ENTIRE_SERIES'])
  recurrenceEditScope?: 'THIS_OCCURRENCE' | 'THIS_AND_FUTURE' | 'ENTIRE_SERIES';
}

export class TaskCompletionDecisionDto {
  @ApiProperty({ enum: TaskCompletionDecision })
  @IsEnum(TaskCompletionDecision)
  decision!: TaskCompletionDecision;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class TaskCompletionQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class TaskCompletionSubmissionParamsDto extends TaskParamsDto {
  @ApiProperty()
  @IsUUID()
  submissionId!: string;
}

export class BulkTaskPriorityDto extends BulkTaskIdsDto {
  @ApiProperty({ enum: TaskPriority })
  @IsEnum(TaskPriority)
  priority!: TaskPriority;
}

export class BulkTaskMembershipsDto extends BulkTaskIdsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  membershipIds!: string[];
}

export class ReplaceTaskMembershipsDto {
  @ApiProperty({ type: [String] })
  @Transform(({ value }) => value ?? [])
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  membershipIds!: string[];
}

export class ReplaceTaskProjectsDto {
  @ApiProperty({ type: [String] })
  @Transform(({ value }) => value ?? [])
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  projectIds!: string[];
}

export class StartTaskTimerDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  replaceRunning?: boolean;
}

export class TaskTimeEntryParamsDto extends TaskParamsDto {
  @ApiProperty()
  @IsUUID()
  timeEntryId!: string;
}

export class CreateTaskTimeEntryDto {
  @ApiProperty()
  @IsDateString()
  startedAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 604800 })
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? undefined : Number(value),
  )
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(604800)
  durationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workspaceMembershipId?: string;
}

export class UpdateTaskTimeEntryDto extends CreateTaskTimeEntryDto {}

export class TaskTimeReportQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workspaceMembershipId?: string;

  @ApiPropertyOptional({ enum: TaskTimeEntryType })
  @IsOptional()
  @IsEnum(TaskTimeEntryType)
  entryType?: TaskTimeEntryType;
}

export class TaskWorkloadQueryDto {
  @ApiPropertyOptional({ enum: ['DAY', 'WEEK'], default: 'WEEK' })
  @IsOptional()
  @IsIn(['DAY', 'WEEK'])
  view: 'DAY' | 'WEEK' = 'WEEK';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 50))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

export class TaskViewFilterQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeMembershipId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tagId?: string;
}

export class TaskCalendarQueryDto extends TaskViewFilterQueryDto {
  @ApiPropertyOptional({ enum: ['MONTH', 'WEEK', 'DAY'], default: 'MONTH' })
  @IsOptional()
  @IsIn(['MONTH', 'WEEK', 'DAY'])
  view: 'MONTH' | 'WEEK' | 'DAY' = 'MONTH';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

export class TaskGanttQueryDto extends TaskViewFilterQueryDto {
  @ApiProperty()
  @IsDateString()
  from!: string;

  @ApiProperty()
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 50))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

export class TaskReportsQueryDto extends TaskViewFilterQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class TaskActivityQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class UpdateTaskScheduleDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  plannedStartAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;
}

export class UpdateWorkspaceMemberCapacityDto {
  @ApiProperty({ minimum: 0, maximum: 10080 })
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(10080)
  weeklyCapacityMinutes!: number;
}

export class TaskAllocationDto {
  @ApiProperty()
  @IsUUID()
  workspaceMembershipId!: string;

  @ApiProperty({ minimum: 0, maximum: 100000 })
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(100000)
  plannedMinutes!: number;
}

export class ReplaceTaskWorkloadAllocationsDto {
  @ApiProperty({ type: [TaskAllocationDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TaskAllocationDto)
  allocations!: TaskAllocationDto[];
}
