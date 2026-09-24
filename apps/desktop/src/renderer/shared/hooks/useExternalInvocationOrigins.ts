import {
	type ExternalInvocationOrigin,
	externalInvocationOrigins,
	replaceExternalInvocationOrigins,
	subscribeExternalInvocationOrigins,
} from "@shared/store/external-invocation-origins";
import { useEffect, useSyncExternalStore } from "react";

export function useExternalInvocationOrigins(): readonly ExternalInvocationOrigin[] {
	const rows = useSyncExternalStore(
		subscribeExternalInvocationOrigins,
		externalInvocationOrigins,
		externalInvocationOrigins,
	);
	useEffect(() => {
		const load = window.vetta?.externalInvocations?.origins;
		if (!load) return;
		let cancelled = false;
		void load()
			.then((rows) => {
				if (!cancelled) replaceExternalInvocationOrigins(rows);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);
	return rows;
}
