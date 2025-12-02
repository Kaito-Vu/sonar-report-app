import { IsString, IsNotEmpty, IsNumberString } from 'class-validator';

export class DeleteProjectDto {
  @IsString()
  @IsNotEmpty()
  @IsNumberString()
  id: string;
}

