export interface BotApi { sendMessage(chatId: number, text: string): Promise<unknown>; }
export function createBotNotificationService(bot: BotApi) {
  return {
    escrow: (buyerId: number, hostId: number) => Promise.all([bot.sendMessage(buyerId, 'Оплата получена. Доступ ожидает подтверждения (24 часа).'), bot.sendMessage(hostId, 'Покупатель оплатил слот. Выдайте доступ.')]),
    completed: (hostId: number, amountKopecks: number) => bot.sendMessage(hostId, `Сделка завершена. Начислено ${(amountKopecks / 100).toFixed(2)} ₽.`),
    disputed: (hostId: number) => bot.sendMessage(hostId, 'Покупатель открыл спор. Проверьте сделку в панели.'),
  };
}
