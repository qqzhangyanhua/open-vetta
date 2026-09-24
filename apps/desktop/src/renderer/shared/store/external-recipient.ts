/** 与输入草稿同一套 key：已有会话用 sessionPath，新会话页用 `new:${cwd}`。 */
const recipients = new Map<string, string>();

export function externalRecipientFor(draftKey: string | null | undefined): string {
	if (!draftKey) return "penguin";
	return recipients.get(draftKey) ?? "penguin";
}

export function rememberExternalRecipient(draftKey: string | null | undefined, recipientId: string): void {
	if (!draftKey) return;
	if (recipientId === "penguin") recipients.delete(draftKey);
	else recipients.set(draftKey, recipientId);
}

/** 草稿 key 从 `new:${cwd}` 换成真实 sessionPath 时，接收方跟着走。 */
export function rekeyExternalRecipient(from: string | null | undefined, to: string): void {
	if (!from || from === to) return;
	const current = recipients.get(from);
	if (!current) return;
	recipients.set(to, current);
	recipients.delete(from);
}

export function clearExternalRecipients(): void {
	recipients.clear();
}
