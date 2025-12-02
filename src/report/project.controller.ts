import { Controller, Get, Post, Body, Res, Render } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Controller('projects')
export class ProjectController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @Render('projects')
  async index() {
    const projects = await this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { projects };
  }

  @Post()
  async create(@Body() body: { name: string; key: string }, @Res() res) {
    if (body.name && body.key) {
      await this.prisma.project.create({
        data: { name: body.name, key: body.key.trim() },
      });
    }
    return res.redirect('/projects');
  }

  @Post('delete')
  async delete(@Body() body: { id: string }, @Res() res) {
    try {
      await this.prisma.project.delete({ where: { id: parseInt(body.id) } });
    } catch {
      // Ignore deletion errors
    }
    return res.redirect('/projects');
  }
}
