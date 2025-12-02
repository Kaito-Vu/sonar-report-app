import { IsString, IsNotEmpty, IsUrl, MaxLength } from 'class-validator';

export class SettingsDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  url: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token: string;
}
