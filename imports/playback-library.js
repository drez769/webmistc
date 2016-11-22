import {Meteor} from 'meteor/meteor';
import {start} from './recording-library.js';
import {Session} from 'meteor/session';

export var Playback = {};

//HACK: scope binding
const self = this;
let timings = [];
let startedTime = -1;
let elapsedTime = -1;
let recordings = "";
let isPaused = false;

// HACK: need to figure out the proper scoping to 
// access this from the overlay library
function replaceNote(whichNote, title, number) {
    const d3Notes = d3.select(".annotation");
    // console.log(d3Notes);
    const d3LastNode = d3Notes[0].pop();
    if (d3LastNode) {
        $(d3LastNode).remove();
        const id = d3LastNode.id;
        Meteor.call('markEraser', title, number, id);
    }
};

function initTimes(recordings) {
    const start = _.head(recordings);
    const stop = _.last(recordings);
    self.start = start.time;
    self.stop = stop.time;
}

function removeTimes(recordings) {
    // drop first and last element
    recordings = _.drop(recordings);
    recordings = _.dropRight(recordings);
    return recordings;
}

Playback.upload = function (json) {
    initTimes(json);
    recordings = removeTimes(json);
};

Playback.skipBack = function () {
    if (isPaused) {
        elapsedTime = elapsedTime - 5000;
        if (elapsedTime < 0) {elapsedTime = 0;}
    } else {
        Playback.pause();
        elapsedTime = elapsedTime - 5000;
        if (elapsedTime < 0) {elapsedTime = 0;}
        Playback.play();
    }
};

Playback.stop = function () {
    _.each(timings, function(timing){
        Meteor.clearTimeout(timing)
    })
    isPaused = false;
    startedTime = -1;
    elapsedTime = -1;
};

Playback.pause = function () {
    _.each(timings, function(timing){
        Meteor.clearTimeout(timing)
    })
    isPaused = true;
    elapsedTime = Date.now()-startedTime;
};

Playback.play = function () {
    let firstTimeStamp = self.start;
    isPaused = false;
    startedTime = Date.now();
    if (elapsedTime != -1) {
        firstTimeStamp += elapsedTime;
        startedTime += elapsedTime;
        elapsedTime = -1;
    }
    _.each(recordings, function (recording) {
        if (recording.time - firstTimeStamp > 0) {
            timings.push(Meteor.setTimeout(
                function () {
                    switch (recording.state) {
                        case 'session':
                            const sessionState = recording.params[0];
                            Session.set(recording.action, sessionState);
                            break;
                        case 'database':
                            const isReplaceOn = Session.get('overlay.tool.replace');
                            if (isReplaceOn) {
                                const title = recording.params[0];
                                const page = recording.params[1];
                                replaceNote('previous', title, page);
                            }
                            Meteor.apply(recording.action, recording.params);
                            break;
                    }
                },
                ( parseInt(recording.time - firstTimeStamp) )
            ));
        }
    });
};

Playback.skipForward = function () {
    if (isPaused) {
        elapsedTime = elapsedTime + 5000;
    } else {
        Playback.pause();
        elapsedTime = elapsedTime + 5000;
        Playback.play();
    }
};

