'use strict';

const request = require("request");
const crypto = require("crypto");
const debug = require("debug")("bot-express:messenger");
const line_bot_sdk = require("@line/bot-sdk");
const secure_compare = require('secure-compare');
Promise.promisifyAll(request);

module.exports = class MessengerLine {

    constructor(options){
        if (!options.line_channel_secret || !options.line_access_token){
            return
        }

        this._channel_secret = options.line_channel_secret;
        this._access_token = options.line_access_token;

        const sdk_config = {
            channelAccessToken: this._access_token,
            channelSecret: this._channel_secret
        };
        this.sdk = new line_bot_sdk.Client(sdk_config);
    }

    multicast(event, to, messages){
        // If this is test, we will not actually issue call out.
        if (["development", "test"].includes(process.env.BOT_EXPRESS_ENV)){
            debug("This is test so we skip the actual call out.");
            return Promise.resolve();
        }

        // return this.sdk.multicast(to, messages);

        let url = "https://api.line.me/v2/bot/message/multicast";
        let headers = {
            Authorization: `Bearer ${this._access_token}`
        }
        let body = {
            to: to,
            messages: messages
        }
        return request.postAsync({
            url: url,
            headers: headers,
            body: body,
            json: true
        }).then((response) => {
            if (response.statusCode == 200){
                return response.body;
            }
            return Promise.reject(response.body);
        });
    }

    send(event, to, messages){
        // If this is test, we will not actually issue call out.
        if (["development", "test"].includes(process.env.BOT_EXPRESS_ENV)){
            debug("This is test so we skip the actual call out.");
            return Promise.resolve();
        }

        //return this.sdk.pushMessage(to, messages);

        let url = "https://api.line.me/v2/bot/message/push";
        let headers = {
            Authorization: `Bearer ${this._access_token}`
        }
        let body = {
            to: to,
            messages: messages
        }
        return request.postAsync({
            url: url,
            headers: headers,
            body: body,
            json: true
        }).then((response) => {
            if (response.statusCode == 200){
                return response.body;
            }
            return Promise.reject(response.body);
        });
    }

    reply_to_collect(event, messages){
        return this.reply(event, messages);
    }

    reply(event, messages){
        // If this is test, we will not actually issue call out.
        if (["development", "test"].includes(process.env.BOT_EXPRESS_ENV)){
            debug("This is test so we skip the actual call out.");
            return Promise.resolve();
        }

        //return this.sdk.replyMessage(event.replyToken, messages);

        let url = "https://api.line.me/v2/bot/message/reply";
        let headers = {
            Authorization: `Bearer ${this._access_token}`
        }
        let body = {
            replyToken: event.replyToken,
            messages: messages
        }
        return request.postAsync({
            url: url,
            headers: headers,
            body: body,
            json: true
        }).then((response) => {
            if (response.statusCode == 200){
                return response.body;
            }
            return Promise.reject(response.body);
        });
    }

    validate_signature(req){
        return new Promise((resolve, reject) => {
            let signature = req.get('X-Line-Signature');
            let raw_body = req.raw_body;

            // Signature Validation
            let hash = crypto.createHmac('sha256', this._channel_secret).update(raw_body).digest('base64');

            if (secure_compare(hash, signature)){
                return resolve();
            }
            return reject();
        })
    }

    static extract_events(body){
        return body.events;
    }

    static identify_event_type(event){
        if (!event.type){
            return "unidentified";
        }
        return event.type;
    }

    static extract_beacon_event_type(event){
        let beacon_event_type;
        if (event.beacon.type == "enter"){
            beacon_event_type = "enter";
        } else if (event.beacon.type == "leave"){
            beacon_event_type = "leave";
        }
        return beacon_event_type;
    }

    static extract_sender_id(event){
        if (event.type === "bot-express:push"){
            return MessengerLine.extract_to_id(event);
        }
        return event.source[`${event.source.type}Id`]
    }

    static extract_session_id(event){
        return MessengerLine.extract_sender_id(event);
    }

    static extract_to_id(event){
        return event.to[`${event.to.type}Id`];
    }

    static extract_param_value(event){
        let param_value;
        switch(event.type){
            case "message":
                if (event.message.type == "text"){
                    param_value = event.message.text;
                } else {
                    param_value = event.message;
                }
            break;
            case "postback":
                param_value = event.postback;
            break;
        }
        return param_value;
    }

    static extract_message(event){
        let message;
        switch(event.type){
            case "message":
                message = event.message;
            break;
            case "postback":
                message = event.postback;
            break;
        }
        return message;
    }

    static extract_message_text(event){
        let message_text;
        switch(event.type){
            case "message":
                message_text = event.message.text;
            break;
            case "postback":
                message_text = event.postback.data;
            break;
        }
        return message_text;
    }

    static extract_postback_payload(event){
        return event.postback.data;
    }

    static check_supported_event_type(event, flow){
        switch(flow){
            case "start_conversation":
                if (event.type == "message" || event.type == "postback"){
                    return true;
                }
                return false;
            break;
            case "reply":
                if (event.type == "message" || event.type == "postback") {
                    return true;
                }
                return false;
            break;
            case "btw":
                if (event.type == "message" || event.type == "postback"){
                    return true;
                }
                return false;
            break;
            default:
                return false;
            break;
        }
    }

    static identify_message_type(message){
        let message_type;
        if (["text", "image", "audio", "video", "file", "location", "sticker", "imagemap", "flex"].includes(message.type)) {
            message_type = message.type;
        } else if (message.type == "template"){
            if (["buttons", "confirm", "carousel"].indexOf(message.template.type) !== -1){
                message_type = message.template.type + "_template";
            } else {
                // This is not LINE format.
                throw new Error("This is not correct LINE format.");
            }
        } else {
            // This is not LINE format.
            throw new Error("This is not correct LINE format.");
        }
        return message_type;
    }

    static compile_message(message_format, message_type, message){
        return MessengerLine[`_compile_message_from_${message_format}_format`](message_type, message);
    }

    static _compile_message_from_facebook_format(message_type, message){
        // LINE format has Text, Audio, File, Image, Video, Button Template, Confirm Template, Carousel Template, Location, Sticker and Imagemap.

        // ### Threshold for Text ###
        // -> text has to be up to 2000 chars.

        // ### Threshold for Button Template ###
        // -> altText has to be up to 400 chars.
        // -> title has to be up to 40 chars.
        // -> text has to be 160 chars. In case we have title or thumbnailImageUrl, it has to be up to 60 chars.
        // -> acitons has to be up to 4.
        // -> each button must follow button threshold.

        // ### Threshold for Confirm Template ###
        // -> altText has to be up to 400 chars.
        // -> text has to be 240 chars.
        // -> acitons has to be 2.
        // -> each button must follow button threshold.

        // ### Threshold for Carousel Template ###
        // -> altText has to be up to 400 chars.
        // -> columns has to be up to 5.
        // -> column title has to be up to 40 chars.
        // -> column text has to be up to 120 chars. In case we have title or thumbnailImageUrl, it has to be up to 60 chars.
        // -> acitons has to be 3.
        // -> each button must follow button threshold.

        // ### Compile Rule Overview ###
        // => text: to text
        // => audio: to audio
        // => image: to image
        // => video: to video
        // => file: to unsupported text
        // => button template: to button template
        // => generic tempalte: to carousel template
        // => list Template: to carousel template
        // => open graph template: to unsupported text
        // => receipt template: to unsupported text
        // => airline boarding ticket template: to unsupported text
        // => airline checkin template: to unsupported text
        // => airline itinerary tempalte: to unsupported text
        // => airline fight update template: to unsupported text

        let compiled_message;

        switch(message_type){
            case "text":
                if (!message.quick_replies){
                    // This is the most pure text message.
                    compiled_message = {
                        type: "text",
                        text: message.text
                    }
                } else {
                    // If the number of quick replies is less than or equal to 4, we try to compile to button template. Otherwise, we just compile it to text message.
                    if (message.quick_replies.length <= 4){
                        compiled_message = {
                            type: "template",
                            altText: message.text,
                            template: {
                                type: "buttons",
                                text: message.text,
                                actions: []
                            }
                        }
                        for (let quick_reply of message.quick_replies){
                            if (quick_reply.content_type == "text"){
                                compiled_message.template.actions.push({
                                    type: "message",
                                    label: quick_reply.title,
                                    text: quick_reply.payload
                                });
                            } else {
                                // quick reply of location type is included but line does not corresponding template type so we insert "unsupported".
                                compiled_message.template.actions.push({
                                    type: "message",
                                    label: "*Unsupported Location Type",
                                    text: "*Unsupported Location Type"
                                });
                            }
                        }
                    } else {
                        // Elements of quick reply is more the 4. It's not supported in LINE so we send just text.
                        debug("Quick replies were omitted since it exceeds max elements threshold.");
                        compiled_message = {
                            type: "text",
                            text: message.text
                        }
                    }
                }
                break;
            case "audio":
                // Not Supported since facebook does not have property corresponding to "duration".
                debug(`Compiling ${message_type} message from facebook format to line format is not supported since facebook does not have the property corresponding to "duration". Supported types are text(may includes quick replies), image and template.`);
                compiled_message = {
                    type: text,
                    text: `*Message type is audio and it was made in facebook format. It lacks required "duration" property so we could not compile.`
                }
                break;
            case "image":
                // Limited support since facebook does not have property corresponding to previewImageUrl.
                compiled_message = {
                    type: "image",
                    originalContentUrl: message.attachment.payload.url,
                    previewImageUrl: message.attachment.payload.url
                }
                if (message.quick_replies){
                    debug("Quick replies were omitted since it is not supported in LINE's image message.");
                }
                break;
            case "video":
                // Not supported since facebook does not have property corresponding to "previewImageUrl".
                debug(`Compiling ${message_type} message from facebook format to line format is not supported since facebook does not have property corresponding to "previewImageUrl". Supported types are text(may includes quick replies), image and template.`);
                compiled_message = {
                    type: text,
                    text: `*Message type is video and it was made in facebook format. It lacks required "previewImageUrl" property so we could not compile.`
                }
                if (message.quick_replies){
                    debug("Quick replies were omitted since it is not supported in LINE's video message.");
                }
                break;
            case "file":
                // Not supported since LINE has its original content storage.
                debug(`Compiling ${message_type} message from facebook format to line format is not supported since LINE has its original content storage.`);
                compiled_message = {
                    type: text,
                    text: `*Compiling ${message_type} message from facebook format to line format is not supported since LINE has its original content storage.`
                }
                break;
            case "button_template":
                compiled_message = {
                    type: "template",
                    altText: message.attachment.payload.text,
                    template: {
                        type: "buttons",
                        text: message.attachment.payload.text,
                        actions: []
                    }
                }
                for (let button of message.attachment.payload.buttons){
                    // Upper threshold of buttons is 3 in facebook and 4 in line. So compiling facebook buttons to line button is safe.
                    if (button.type == "postback"){
                        compiled_message.template.actions.push({
                            type: "postback",
                            label: button.title,
                            data: button.payload
                        });
                    } else if (button.type == "web_url"){
                        compiled_message.template.actions.push({
                            type: "uri",
                            label: button.title,
                            uri: button.url
                        });
                    } else {
                        // Not supported since line does not have corresponding template.
                        debug(`Compiling template messege including ${button.type} button from facebook format to line format is not supported since line does not have corresponding template.`);
                        compiled_message = {
                            type: "text",
                            text: `*Compiling template messege including ${button.type} button from facebook format to line format is not supported since line does not have corresponding template.`
                        }
                        break;
                    }
                }
                break;
            case "generic_template": // -> to carousel template
                // Upper threshold of generic template elements is 10 and 5 in line. So we have to care about it.
                compiled_message = {
                    type: "template",
                    altText: "Carousel Template", // This is a dummy text since facebook does not have corresponiding property.
                    template: {
                        type: "carousel",
                        columns: []
                    }
                }
                if (message.attachment.payload.elements.length > 5){
                     compiled_message = {
                        type: "text",
                        text: `*Message type is facebook's generic template. It exceeds the LINE's max elements threshold of 5.`
                    }
                    break;
                }
                for (let element of message.attachment.payload.elements){
                    let column = {
                        text: element.title,
                        thumbnailImageUrl: element.image_url,
                        actions: []
                    }
                    for (let button of element.buttons){
                        // Upper threshold of buttons is 3 in facebook and 3 in line. So compiling facebook buttons to line button is safe.
                        if (button.type == "postback"){
                            column.actions.push({
                                type: "postback",
                                label: button.title,
                                data: button.payload
                            });
                        } else if (button.type == "web_url"){
                            column.actions.push({
                                type: "uri",
                                label: button.title,
                                uri: button.url
                            });
                        } else {
                            // Not supported since line does not have corresponding template.
                            debug(`Compiling template messege including ${button.type} button from facebook format to line format is not supported since line does not have corresponding button.`);
                            return compiled_message = {
                                type: "text",
                                text: `*Compiling template messege including ${button.type} button from facebook format to line format is not supported since line does not have corresponding button.`
                            }
                        }
                    }
                    compiled_message.template.columns.push(column);
                }
                break;
            case "list_template": // -> to carousel template
                // Upper threshold of list template elements is 4 and 5 in line. This is safe.
                compiled_message = {
                    type: "template",
                    altText: "Carousel Template", // This is a dummy text since facebook does not have corresponiding property.
                    template: {
                        type: "carousel",
                        columns: []
                    }
                }
                if (message.attachment.payload.buttons){
                    debug(`Message type is facebook's list template. It has List button but LINE's carousel message does not support it`);
                    compiled_message = {
                       type: "text",
                       text: `*Message type is facebook's ${message_type}. It has List button but LINE's carousel message does not support it.`
                    }
                    break;
                }
                for (let element of message.attachment.payload.elements){
                    let column = {
                        text: element.title,
                        thumbnailImageUrl: element.image_url,
                        actions: []
                    }
                    for (let button of element.buttons){
                        // Upper threshold of buttons is 3 in facebook and 3 in line. So compiling facebook buttons to line button is safe.
                        if (button.type == "postback"){
                            column.actions.push({
                                type: "postback",
                                label: button.title,
                                data: button.payload
                            });
                        } else if (button.type == "web_url"){
                            column.actions.push({
                                type: "uri",
                                label: button.title,
                                uri: button.url
                            });
                        } else {
                            // Not supported since line does not have corresponding template.
                            debug(`Compiling template messege including ${button.type} button from facebook format to line format is not supported since line does not have corresponding template.`);
                            return compiled_message = {
                                type: "text",
                                text: `*Compiling template messege including ${button.type} button from facebook format to line format is not supported since line does not have corresponding template.`
                            }
                        }
                    }
                    compiled_message.template.columns.push(column);
                }
                break;
            case "open_graph":
                debug(`*Message type is facebook's ${message_type} and it is not supported in LINE.`);
                compiled_message = {
                   type: "text",
                   text: `*Message type is facebook's ${message_type} and it is not supported in LINE.`
                }
                break;
            case "airline_boardingpass":
                debug(`*Message type is facebook's ${message_type} and it is not supported in LINE.`);
                compiled_message = {
                   type: "text",
                   text: `*Message type is facebook's ${message_type} and it is not supported in LINE.`
                }
                break;
            case "airline_itinerary":
                debug(`*Message type is facebook's ${message_type} and it is not supported in LINE.`);
                compiled_message = {
                   type: "text",
                   text: `*Message type is facebook's ${message_type} and it is not supported in LINE.`
                }
                break;
            case "airline_update":
                debug(`*Message type is facebook's ${message_type} and it is not supported in LINE.`);
                compiled_message = {
                   type: "text",
                   text: `*Message type is facebook's ${message_type} and it is not supported in LINE.`
                }
                break;
            default:
                debug(`*Message type is facebook's ${message_type} and it is not supported in LINE.`);
                compiled_message = {
                   type: "text",
                   text: `*Message type is facebook's ${message_type} and it is not supported in LINE.`
                }
                break;
        }
        return compiled_message;
    }

    static translate_message(translater, message_type, message, sender_language){
        switch(message_type){
            case "text": {
                return translater.translate(message.text, sender_language).then(
                    (response) => {
                        message.text = response[0];
                        debug("Translated message follows.");
                        debug(message);
                        return message;
                    }
                );
                break;
            }
            case "buttons_template":
            case "confirm_template": {
                let source_texts = [message.altText, message.template.text];
                for (let action of message.template.actions){
                    source_texts.push(action.label);
                    if (action.type == "message"){
                        source_texts.push(action.text);
                    }
                }
                return translater.translate(source_texts, sender_language).then(
                    (response) => {
                        message.altText = response[0][0];
                        message.template.text = response[0][1];
                        let offset = 2;
                        for (let action of message.template.actions){
                            action.label = response[0][offset];
                            offset++;
                            if (action.type == "message"){
                                action.text = response[0][offset];
                                offset++;
                            }
                        }
                        debug("Translated message follows.");
                        debug(message);
                        if (message.template.actions){
                            debug("Actions follows");
                            debug(message.template.actions);
                        }
                        return message;
                    }
                );
                break;
            }
            case "carousel_template": {
                let source_texts = [message.altText];
                for (let column of message.template.columns){
                    if (column.title) source_texts.push(column.title);
                    source_texts.push(column.text);

                    for (let action of column.actions){
                        source_texts.push(action.label);
                        if (action.type == "message"){
                            source_texts.push(action.text);
                        }
                    }
                }
                return translater.translate(source_texts, sender_language).then(
                    (response) => {
                        message.altText = response[0][0];

                        let offset = 1;
                        for (let column of message.template.columns){
                            if (column.title){
                                column.title = response[0][offset];
                                offset++;
                            }
                            column.text = response[0][offset];
                            offset++;

                            for (let action of column.actions){
                                action.label = response[0][offset];
                                offset++;
                                if (action.type == "message"){
                                    action.text = response[0][offset];
                                    offset++;
                                }
                            }
                        }
                        debug("Translated message follows.");
                        debug(message);
                        return message;
                    }
                );
                break;
            }
            /*
            case "flex": {
            }
            */
            default: {
                return Promise.resolve(message);
                break;
            }
        }
    }
};
