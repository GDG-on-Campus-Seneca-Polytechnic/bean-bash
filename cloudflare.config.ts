import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
	worker: {
		name: "gdg-bean-bash",
		compatibilityDate: "2026-09-01",
		entrypoint: "src/server.js",
		observability: {
			enabled: true,
		},
		env: {
			ROOMS: bindings.durableObject({
				worker: "gdg-bean-bash",
				exportName: "Room",
			}),
			ASSETS: bindings.assets(),
		},
		exports: {
			Room: exports.durableObject({
				storage: "sqlite",
			}),
		},
	},
});
