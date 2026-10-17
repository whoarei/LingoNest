import { createApp } from "vue";
import App from "./App.vue";
import "./platform/base.css";
import { createApplicationServices } from "./application/services";
const app = createApp(App);
createApplicationServices().install(app);
app.mount("#app");
