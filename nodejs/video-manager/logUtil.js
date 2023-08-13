import log4js from 'log4js'

log4js.configure({
    appenders: { video_manager: { type: "file", filename: "logs/video_manager.log" } },
    categories: { default: { appenders: ["video_manager"], level: "info" } },
});

const logger = log4js.getLogger("video_manager");

export default logger;
