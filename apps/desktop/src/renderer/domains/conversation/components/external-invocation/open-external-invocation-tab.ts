import { pathBasename } from "@shared/lib/utils";
import { dispatchBottomPanelAtomFamily, type ExternalInvocationPanelPayload } from "@shared/store/atoms";
import { atom } from "jotai";

export const openExternalInvocationTabAtom = atom(
	null,
	(
		_get,
		set,
		input: {
			readonly scopeKey: string;
			readonly invocationId: string;
			readonly status: ExternalInvocationPanelPayload["status"];
			readonly cwd: string;
			readonly sessionId: string;
			readonly agentLabel?: string;
			readonly externalSessionId?: string | null;
			readonly agentId?: string;
			readonly createIfMissing?: boolean;
		},
	) => {
		set(dispatchBottomPanelAtomFamily(input.scopeKey), {
			type: "open-external-invocation",
			tabId: input.invocationId,
			newLeafId: `leaf-${input.invocationId}`,
			payload: {
				invocationId: input.invocationId,
				status: input.status,
				agentLabel: input.agentLabel ?? "Grok",
				projectLabel: pathBasename(input.cwd),
				sessionId: input.sessionId,
				externalSessionId: input.externalSessionId,
				agentId: input.agentId,
			},
			createIfMissing: input.createIfMissing,
		});
	},
);
