import { Controller, Post, Get, Body } from '@nestjs/common';
import { whatsappService } from '../notifications/whatsapp.service';
import { Admin } from '../auth/admin.decorator';

@Admin()
@Controller('test')
export class TestController {
  @Post('whatsapp')
  async testWhatsapp(@Body() body: { phone: string; message: string }) {
    console.log(`📱 Enviando mensaje a ${body.phone}...`);
    const result = await whatsappService.sendMessage(body.phone, body.message);
    return { success: result, phone: body.phone };
  }

  @Get('grupos')
  async getGroups() {
    const groups = await whatsappService.getGroups();
    return { groups };
  }

  @Post('grupo')
  async testGrupo(@Body() body: { message: string }) {
    const result = await whatsappService.sendGroupMessage(
      process.env.WHATSAPP_GROUP_ID,
      body.message,
    );
    return {
      success: result,
      groupId: process.env.WHATSAPP_GROUP_ID,
      whatsappReady: whatsappService.isReady(),
    };
  }
}
