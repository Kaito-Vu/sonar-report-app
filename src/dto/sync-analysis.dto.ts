import { IsString, IsNotEmpty } from 'class-validator';

export class SyncAnalysisDto {
  @IsString()
  @IsNotEmpty()
  analysisKey: string;

  @IsString()
  @IsNotEmpty()
  date: string;
}

