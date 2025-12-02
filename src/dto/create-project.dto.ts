import { IsString, IsNotEmpty, Matches, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9_-]+$/, {
    message:
      'Key must contain only uppercase letters, numbers, hyphens, and underscores',
  })
  @MaxLength(100)
  key: string;
}

