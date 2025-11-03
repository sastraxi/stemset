import { getToken } from "../lib/storage";
import { client } from "./generated/client.gen";

const API_BASE = import.meta.env.VITE_API_URL || "";

client.setConfig({
	baseUrl: API_BASE,
});

client.interceptors.request.use((request, _options) => {
	const token = getToken();
	if (token) {
		// Headers on Request objects are immutable, so we need to create a new Request
		const headers = new Headers(request.headers);
		headers.set("Authorization", `Bearer ${token}`);
		return new Request(request, { headers });
	}
	return request;
});
