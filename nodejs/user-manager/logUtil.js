import log4js from 'log4js'

log4js.configure({
    appenders: { user_manager: { type: "file", filename: "logs/user_manager.log" } },
    categories: { default: { appenders: ["user_manager"], level: "info" } },
});

const logger = log4js.getLogger("user_manager");

export default logger;
