import FileSaver from 'filesaverjs';
import MediaStreamRecorder from 'msr';
import StereoAudioRecorder from 'msr';
import JSZip from 'jszip'
// wrong syntax
// with brackets means exported variable of module
// without brackets means entire module
import {Playback} from '../imports/playback-library.js';
import {Recordings} from '../imports/recording-library.js';

//constants
let CONFERENCE_ROOM_ID = '1234';
let MILLISECOND_INTERVAL = 10000; //10 seconds in ms
let FILE_TYPE = 'webm';

//this import is included from the index.html <script> tag.
let _connection = new RTCMultiConnection();
let _mediaRecorderList = [];
let _audioVideo = {};
let _isRecording = false;
let _currentRecordingURL = "";
let _isPresenter = false;

if (Meteor.isClient) {
    // libraries
    let overlayLibrary;
    let slideLibrary;

    // Startup
    Meteor.startup(function () {
        _ = lodash;
        slideLibrary = new SlideLibrary('WelcomeToMISTCweb');
        overlayLibrary = new OverlayLibrary();

        // slides
        Meteor.subscribe('slidesCollection', function () {
            let url = '/slides/' + slideLibrary.title() + '.pdf';
            PDFJS.getDocument(url).then(function (slide) {
                slideLibrary.set(slide);
                let slideDocument = SlidesCollection.find({_id: slideLibrary.title()}).fetch()[0];
                if (!slideDocument) {
                    Session.set('slide.page', 'first');
                    SlidesCollection.insert({_id: slideLibrary.title(), page: slideLibrary.getPage('first')});
                } else if (slideDocument.page) {
                    Session.set('slide.page', slideDocument.page);
                }
                slideLibrary.render(slideLibrary.getPage(Session.get('slide.page')));
            });
        });
        // presentations
        Meteor.subscribe('presentations', function () {
            let hasPresentations = Presentations.find({}).count() > 0;
            if (!hasPresentations) {
                Presentations.insert({
                    _id: slideLibrary.title() + ( Session.get('slide.page') || slideLibrary.getPage('first') ),
                    overlay: []
                });
            }
        });
        // messages
        Meteor.subscribe('recordings');

        // messages
        Meteor.subscribe('messages');

        // questions
        Meteor.subscribe('questions');

        Tracker.autorun(function () {
            // slides
            let slideDocument = SlidesCollection.find({_id: slideLibrary.title()}).fetch()[0];
            if (slideDocument && slideLibrary) {
                Session.set('slide.page', slideDocument.page);
                slideLibrary.render(slideDocument.page);
            }
        });

        Tracker.autorun(function () {
            // overlay
            let data = Presentations.find({_id: slideLibrary.title() + Session.get('slide.page')}).fetch()
            if (data.length) {
                data = data[0].overlay;
            }
            if (overlayLibrary) {
                overlayLibrary.draw(data);
            }
        });

    });

    // Accounts
    Accounts.ui.config({
        passwordSignupFields: 'USERNAME_ONLY'
    });

    // Slide Navigation
    Template.slideNavPanel.onRendered(function () {
        $('#slide-nav-gallery').slick({
            dots: true,
            arrows: true,
            infinite: false,
            slidesToShow: 5,
            slidesToScroll: 2
        });
    });

    Template.slideNavPanel.events({
        'click .slide-nav-option': function (event) {
            let number = $(event.currentTarget).attr('data-slide');
            slideLibrary.setPage(number);
        }
    });

    // Tool Panel
    Template.toolPanel.events({
        'click #overlay-btn-tool-clear': function (event) {
            Meteor.call('clear', slideLibrary.title(), Session.get('slide.page'), function () {
                overlayLibrary.clear();
            });
        },
        'click .overlay-btn-tool': function (event) {
            let tool = $(event.currentTarget).attr('data-tool');
            changeTool(tool);
        },
        'click .overlay-btn-color': function (event) {
            let color = $(event.currentTarget).attr('data-color');
            Session.set('overlay.color', color);
        },
        'click .overlay-btn-size': function (event) {
            let size = $(event.currentTarget).attr('data-size');
            Session.set('overlay.size.outline', size);
        },
        'click .overlay-btn-text': function (event) {
            let text = $(event.currentTarget).attr('data-size');
            Session.set('overlay.size.font', text);
        },
        'click .overlay-btn-sticky-replace > .toggle': function (event) {
            let stickyMode = $(event.currentTarget).hasClass('off');
            let replaceMode = !stickyMode;
            Session.set('overlay.tool.replace', replaceMode);
            if (Session.get('recording.happening')) {
                Meteor.call('recordings.insert', {
                    state: 'session',
                    action: 'overlay.tool.replace',
                    params: [replaceMode],
                    time: Date.now(),
                });
            }
        },
        'click .overlay-btn-recording[title="Recording"]': function (event) {
            $(event.currentTarget).toggleClass('on');
            let recordingMode = $(event.currentTarget).hasClass('on');
            let color = recordingMode ? 'crimson' : '';
            $(event.currentTarget).css("color", color);
            Session.set('overlay.tool.recording', recordingMode);
            Session.set('recording.happening', recordingMode);
            if (Session.get('recording.happening')) {
                const time = Date.now();
                Meteor.call('recordings.start');
                Meteor.call('recordings.insert', {
                    state: 'time',
                    action: 'start',
                    params: [time],
                    time: time,
                });
                Meteor.call('recordings.insert', {
                    state: 'session',
                    action: 'overlay.tool.replace',
                    params: [Session.get('overlay.tool.replace')],
                    time: time + 1,
                });
                Meteor.call('recordings.insert', {
                    state: 'session',
                    action: 'slide.page',
                    params: [Session.get('slide.page')],
                    time: Date.now(),
                });
                Meteor.call('recordings.insert', {
                    state: 'database',
                    action: 'slides.change',
                    params: [slideLibrary.title(), Session.get('slide.page')],
                    time: Date.now(),
                });
                //re-initialize when starting recording (no ability to pause)
                _audioVideo = {
                    "_id": CONFERENCE_ROOM_ID,
                    "time": null,
                    "presenter": {},
                    "participants": {}
                };
                let first = true;
                _isRecording = true;
                _currentRecordingURL = '';
                document.getElementById('downloadBtn').disabled = true;
                //this starts recording for every stream - local is always first
                _mediaRecorderList.forEach(function (mediaRecorder) {
                    mediaRecorder.start(MILLISECOND_INTERVAL);
                    mediaRecorder.startTime = new Date();
                    //the first is the local stream, this constant ID's when we started recording
                    if (first) {
                        _audioVideo.time = mediaRecorder.startTime;
                        first = false;
                    }
                });
            } else {
                //this stops recording for every stream - local should be last
                _mediaRecorderList.reverse().forEach(function (mediaRecorder) {
                    mediaRecorder.stop();
                });
                //reverse is in place so change it back
                _mediaRecorderList.reverse();
                //allow time for all recorders to fully stop.
                setTimeout(function () {
                    _isRecording = false;
                    //get resulting video url
                    let formData = new FormData();
                    formData.append('json', JSON.stringify(_audioVideo));
                    let xhr = new XMLHttpRequest();
                    xhr.onreadystatechange = function () {
                        if (xhr.readyState === XMLHttpRequest.DONE) {
                            if (xhr.status === 200) {
                                let jsonResponse = JSON.parse(xhr.responseText);
                                _currentRecordingURL = jsonResponse['video'];
                                document.getElementById('downloadBtn').disabled = false;
                            }
                            else {
                                alert('A error occurred while trying to create the recording.');
                            }
                        }
                    };
                    xhr.open('POST', 'https://www.jkwiz.com/combine3.php');
                    xhr.send(formData);
                    const time = Date.now();
                    Meteor.call('recordings.insert', {
                        state: 'time',
                        action: 'stop',
                        params: [time],
                        time: time,
                    });
                    Meteor.call('recordings.stop');
                }, _mediaRecorderList.length * 3000);
            }
        },
        'click .overlay-btn-recording[title="Download"]': function (event) {
            let xhr = new XMLHttpRequest();
            xhr.responseType = 'blob';
            xhr.onreadystatechange = function () {
                if (xhr.readyState === XMLHttpRequest.DONE) {
                    if (xhr.status === 200) {
                        const recording = Recordings.find({}).fetch();
                        const recordingBlob = new Blob([JSON.stringify(recording, null, 2)], {type: "application/json;charset=utf-8"});
                        const audioVideoBlob = new Blob([JSON.stringify(_audioVideo, null, 2)], {type: "application/json;charset=utf-8"});
                        //zip and download file with both recording.json and recording.webm
                        let jsZip = new JSZip();
                        jsZip.file("recording.json", recordingBlob);
                        jsZip.file("audio-video.json", audioVideoBlob);
                        jsZip.file("recording.webm", xhr.response);
                        jsZip.generateAsync({type: "blob"}).then(function (content) {
                            FileSaver.saveAs(content, "recording.zip");
                        });
                    }
                    else {
                        alert('An error occurred while trying to download the recording.');
                    }
                }
            };
            xhr.open('GET', _currentRecordingURL);
            xhr.send();
        }
    });

    Template.toolPanel.helpers({
        hasSelectedTextTool: function () {
            return _.isEqual(Session.get('overlay.tool'), 'text');
        }
    });

    // Control
    Template.controlPanel.onRendered(function () {
        $('.slider-selection').slider({
            formatter: function (value) {
                return 'Current value: ' + value;
            }
        });
    });

    Template.controlPanel.events({
        'click .control-btn-slide-picker-button': function (event) {
            const jqSlidePicker = $('.control-btn-slide-picker');
            jqSlidePicker.click();
            event.preventDefault();
        },
        'change .control-btn-slide-picker': function (event) {
            const jqSlidePicker = $(event.currentTarget);
            let jqRecording = jqSlidePicker.get(0).files[0];
            let jsZip = require('jszip');
            //have to chain promises, need something similar to q.defer in angularJS.
            jsZip.loadAsync(jqRecording).then(function (zip) {
                zip.file("recording.json").async("string").then(function (recordedJsonStr) {
                    zip.file("recording.webm").async("uint8array").then(function (videoData) {
                        let video = document.createElement('video');
                        video.src = URL.createObjectURL(new Blob([videoData], {type: 'video/webm'}));
                        video.controls = true;
                        //remove the video once the recording has stopped playing.
                        video.onended = function () {
                            document.getElementById('control-fluid').removeChild(video);
                        };
                        //add the video and play the JSON / video simultaneously.
                        document.getElementById('control-fluid').appendChild(video);
                        video.id = 'uploadedRecording';
                        video.play();
                        Playback.upload(JSON.parse(recordedJsonStr));
                        Playback.play();
                    });
                });
            });
        },
        'click .btn-skip-back': function () {
            let video = document.getElementById('uploadedRecording');
            video.currentTime = video.currentTime - 5;
            Playback.skipBack();

        },
        'click .btn-stop': function () {
            let video = document.getElementById('uploadedRecording');
            video.currentTime = 0;
            video.pause();
            Playback.stop();
        },
        'click .btn-pause': function () {
            let video = document.getElementById('uploadedRecording');
            video.pause();
            Playback.pause();
        },
        'click .btn-play': function () {
            let video = document.getElementById('uploadedRecording');
            video.play();
            Playback.play();
        },
        'click .btn-skip-forward': function () {
            let video = document.getElementById('uploadedRecording');
            video.currentTime = video.currentTime + 5;
            Playback.skipForward();
        },
    });

    // Questions

    Template.questionPanel.helpers({
        questions: function () {
            return Questions.find({}, {sort: {time: 1}});
        }
    });

    // Chat

    Template.chatPanel.helpers({
        messages: function () {
            return Messages.find({}, {sort: {time: 1}});
        }
    });

    Template.chatInput.events({
        'keydown textarea#chat-input-message': function (event) {
            if (!Meteor.userId()) {
                throw new Meteor.Error('not-authorized');
            }
            let $input = $(event.target);
            let enterKey = 13; // 13 is the enter key event
            if (event.which === enterKey) {
                if (Meteor.user()) {
                    let name = Meteor.user().username;
                } else {
                    let name = 'Anonymous';
                }
                if ($input.val() != '') {
                    let timestamp = Date.now().toString();
                    let message = $input.val();
                    Meteor.call('messages.new', name, message, timestamp);
                    Meteor.call('recordings.insert', {
                        state: 'database',
                        action: 'messages.new',
                        params: [name, message, timestamp],
                        time: Date.now(),
                    });
                    $input.val('');
                }
                let $messages = $('#chat-panel');
                $messages.scrollTop($messages[0].scrollHeight);
            }
        }
    });

    Template.chatPanel.events({
        // very ugly parent nesting, needs some TLC
        'click .glyphicon-star': function (event) {
            let $target = $(event.currentTarget);
            let name = $target.parent().parent().attr('data-name');
            let message = $target.parent().text().trim();
            let timestamp = $target.parent().parent().attr('data-time');
            Meteor.call('moveToQuestionPanel', name, message, timestamp);
            Meteor.call('recordings.insert', {
                state: 'database',
                action: 'moveToQuestionPanel',
                params: [name, message, timestamp],
                time: Date.now(),
            });
        }
    });

    Template.questionPanel.events({
        // very ugly parent nesting, needs some TLC
        'click .glyphicon-remove': function (event) {
            let $target = $(event.currentTarget);
            let timestamp = $target.parent().parent().attr('data-time');
            let question = Questions.find({time: timestamp}).fetch()[0];
            Meteor.call('moveToChatPanel', question.name, question.message, question.time);
            Meteor.call('recordings.insert', {
                state: 'database',
                action: 'moveToChatPanel',
                params: [question.name, question.message, question.time],
                time: Date.now(),
            });
        }
    });

    // Overlay
    function changeTool(_tool) {
        let tool = _tool;
        let cursor = $('[data-tool="' + tool + '"]').attr('data-cursor');
        Session.set('overlay.tool', tool);
        Session.set('overlay.cursor', cursor);
        changeCursor();
    }

    function changeCursor() {
        let cursor = Session.get('overlay.cursor');
        let tool = Session.get('overlay.tool');
        let color = _.isEqual(tool, 'erase') ? 'LightCoral' : Session.get('overlay.color');
        let rotation = ( _.isEqual(tool, 'line') || _.isEqual(tool, 'arrow') ) ? -45 : 0;
        $('#overlay').awesomeCursor(cursor, {
            color: color,
            rotate: rotation
        });
    }

    Template.overlay.onCreated(function () {
        // press CONTROL+Z to remove latest annotation from current slide
        key('control+z', 'keyboard-shortcuts', function () {
            overlayLibrary.undo(slideLibrary.title(), slideLibrary.getPage());
        });

        // press 1-7 to change tools
        key('1', 'keyboard-shortcuts', function () {
            changeTool('text');
        });
        key('2', 'keyboard-shortcuts', function () {
            changeTool('pencil');
        });
        key('3', 'keyboard-shortcuts', function () {
            changeTool('line');
        });
        key('4', 'keyboard-shortcuts', function () {
            changeTool('arrow');
        });
        key('5', 'keyboard-shortcuts', function () {
            changeTool('ellipse');
        });
        key('6', 'keyboard-shortcuts', function () {
            changeTool('rect');
        });
        key('7', 'keyboard-shortcuts', function () {
            changeTool('erase');
        });

        // press - and = to cycle through colors
        key('-', 'keyboard-shortcuts', function () {
            let color = overlayLibrary.cycleLeftToolColor();
            Session.set('overlay.color', color);
            changeCursor();
        });
        key('=', 'keyboard-shortcuts', function () {
            let color = overlayLibrary.cycleRightToolColor();
            Session.set('overlay.color', color);
            changeCursor();
        });

        // press _ and + to cycle through sizes
        key('shift+-', 'keyboard-shortcuts', function () {
            let hasSelectedTextTool = _.isEqual(Session.get('overlay.tool'), 'text');
            if (hasSelectedTextTool) {
                let fontSize = overlayLibrary.cycleLeftTextSize();
                Session.set('overlay.size.font', fontSize);
            } else {
                let outlineSize = overlayLibrary.cycleLeftToolSize();
                Session.set('overlay.size.outline', outlineSize);
            }
        });
        key('shift+=', 'keyboard-shortcuts', function () {
            let hasSelectedTextTool = _.isEqual(Session.get('overlay.tool'), 'text');
            if (hasSelectedTextTool) {
                let fontSize = overlayLibrary.cycleRightTextSize();
                Session.set('overlay.size.font', fontSize);
            } else {
                let outlineSize = overlayLibrary.cycleRightToolSize();
                Session.set('overlay.size.outline', outlineSize);
            }
        });

        // press ENTER to store new textbox
        key('enter', 'text-entry', function () {
            let jqTextInput = $('.annotation-text-input.annotation-text-active').first();
            let isReplaceOn = Session.get('overlay.tool.replace');
            let isUsingEraser = _.isEqual(Session.get('overlay.tool'), 'erase');
            overlayLibrary.removeActiveText();
            key.filter = key.filters['all'];
            key.setScope('keyboard-shortcuts');
            overlayLibrary.storeTextbox(slideLibrary.title(), slideLibrary.getPage(), jqTextInput.get(0));
            if (isReplaceOn && !isUsingEraser) {
                overlayLibrary.replaceNote('previous', slideLibrary.title(), slideLibrary.getPage());
            }
        });
        // press ESCAPE to cancel text entry
        key('escape', 'text-entry', function () {
            key.filter = key.filters['all'];
            key.setScope('keyboard-shortcuts');
            overlayLibrary.cancelText();
        });

        key.setScope('keyboard-shortcuts');
    });

    key.filters = {
        'all': function filter(event) {
            let tagName = (event.target || event.srcElement).tagName;
            // ignore keypressed in any elements that support keyboard data input
            return !(tagName == 'INPUT' || tagName == 'SELECT' || tagName == 'TEXTAREA');
        },
        'keyboard-shortcuts': function filter(event) {
            let tagName = (event.target || event.srcElement).tagName;
            // ignore keypressed in any elements that support keyboard data input
            return !(tagName == 'INPUT' || tagName == 'SELECT' || tagName == 'TEXTAREA');
        },
        'text-entry': function filter(event) {
            let tagName = (event.target || event.srcElement).tagName;
            return (tagName === 'SPAN');
        }
    };

    Template.overlay.onRendered(function () {
        //configure default conference settings.
        //currently the first user to begin is the instructor.
        //we include video but have no plans for video recording.
        _connection.socketURL = 'https://mistc.jkwiz.com:9001/';
        _connection.session = {
            audio: true,
            video: true
        };
        _connection.sdpConstraints.mandatory = {
            OfferToReceiveAudio: true,
            OfferToReceiveVideo: true
        };
        _connection.enableLogs = false;
        _connection.onstream = function (event) {
            document.getElementById('control-fluid').appendChild(event.mediaElement);
            startStream(event);
        };
        _connection.onstreamended = function (event) {
            //Slightly modified default code
            if (!event.mediaElement) {
                event.mediaElement = document.getElementById(event.streamid);
            }
            if (event.mediaElement && event.mediaElement.parentNode) {
                event.mediaElement.parentNode.removeChild(event.mediaElement);
            }
            //End default code
            let target;
            _mediaRecorderList.forEach(function (mediaRecorder, index) {
                //find the matching recorder
                if (mediaRecorder.streamid === event.streamid) {
                    target = index;
                }
            });
            //remove recorder from the list
            if (target !== undefined) {
                _mediaRecorderList.splice(target, 1);
            }
        };
        //join existing room or assume leader.
        _connection.checkPresence(CONFERENCE_ROOM_ID, function (isRoomExists) {
            if (isRoomExists) {
                _connection.join(CONFERENCE_ROOM_ID);
            }
            else {
                _connection.open(CONFERENCE_ROOM_ID);
                _isPresenter = true;
            }
        });
        //mute toggle button for muting/unmuting. Should work for the live stream and recording.
        document.getElementById('muteButton').onclick = function() {
            //implicit this object refers to the getElementById object.
            if (_mediaRecorderList.length > 0) {
                let streamObject = _connection.streamEvents[_mediaRecorderList[0].streamid];
                //the first stream in the list is always the local stream, but we check here anyway.
                if (streamObject.type === 'local') {
                    if (streamObject.stream.getAudioTracks()[0]) {
                        streamObject.stream.getAudioTracks()[0].enabled =
                            !streamObject.stream.getAudioTracks()[0].enabled;
                    }
                    if (streamObject.stream.getVideoTracks()[0]) {
                        streamObject.stream.getVideoTracks()[0].enabled =
                            !streamObject.stream.getVideoTracks()[0].enabled;
                    }
                    if (streamObject.stream.getAudioTracks()[0].enabled) {
                        streamObject.stream.unmute('both');
                        this.innerHTML = 'Mute';
                    }
                    else {
                        streamObject.stream.mute('both');
                        this.innerHTML = 'Unmute';
                    }
                }
            }
        }
    });

    function startStream(event) {
        let mediaRecorder = new MediaStreamRecorder(event.stream);
        //used to remove the recorder when the stream ends
        mediaRecorder.streamid = event.streamid;
        //only the presenter will record video, we will merge audio into this video
        mediaRecorder.mimeType = (_isPresenter) ? 'video/' + FILE_TYPE : 'audio/' + FILE_TYPE;
        mediaRecorder.disableLogs = true;
        mediaRecorder.recorderType = StereoAudioRecorder;
        //this method is called every interval [the value passed to start()]
        mediaRecorder.ondataavailable = function (blob) {
            //the timestamp must be generated immediately to preserve the offset
            let result = {
                'time': new Date()
            };
            //the interval is NOT always exactly MILLISECOND_INTERVAL
            let runTimeMs = result.time.getTime() - mediaRecorder.startTime.getTime();
            mediaRecorder.startTime = result.time;
            //upload file to the server
            let formData = new FormData();
            formData.append('file', blob);
            formData.append('ext', "." + FILE_TYPE);
            let xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function () {
                if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {
                    let target = (_isPresenter) ? _audioVideo.presenter : _audioVideo.participants;
                    let jsonResponse = JSON.parse(xhr.responseText);
                    //identifier generated on the server to avoid collisions
                    result['_id'] = jsonResponse['_id'];
                    //stream does not exist yet
                    if (target[event['streamid']] === undefined) {
                        target[event['streamid']] = [];
                    }
                    //only participants have offsets
                    if (!_isPresenter) {
                        let msBefore = (result.time.getTime() - runTimeMs) - _audioVideo.time.getTime();
                        result['offset'] = (msBefore / 1000).toFixed(3);
                    }
                    //push new recording into list
                    target[event['streamid']].push(result);
                }
            };
            xhr.open('POST', 'https://www.jkwiz.com/mistc.php');
            xhr.send(formData);
        };
        //local stream is always first
        if (event.type === 'local') {
            _mediaRecorderList.unshift(mediaRecorder);
            //only the presenter can record
            if (_isPresenter) {
                document.getElementById('recordBtn').disabled = false;
            }
        }
        else {
            _mediaRecorderList.push(mediaRecorder);
        }
        //someone has joined an existing session that is already in progress
        if (_isRecording) {
            mediaRecorder.start(MILLISECOND_INTERVAL);
            mediaRecorder.startTime = new Date();
        }
    }

    Template.overlay.events({
        'click': function (event) {
            let hasClickedLeftMouseButton = _.isEqual(event.which, 1);
            if (!hasClickedLeftMouseButton) {
                return true;
            }
            //-------------------------------------------------------
            let d3Target = d3.select(event.currentTarget);
            let hasSelectedTextTool = _.isEqual(Session.get('overlay.tool'), 'text');
            let isReplaceOn = Session.get('overlay.tool.replace');
            let isUsingEraser = _.isEqual(Session.get('overlay.tool'), 'erase');
            let isTargetTextInput = d3Target.classed('annotation-text-input');
            let isTargetTextHandle = d3Target.classed('annotation-text-handle');
            if (isReplaceOn) {
                if (isTargetTextInput) {
                    overlayLibrary.setActiveText(d3Target.node());
                    key.setScope('text-entry');
                    key.filter = key.filters['text-entry'];
                } else { // nothing, shape, or handle is here
                    if (!isTargetTextHandle) {
                        if (hasSelectedTextTool) {
                            overlayLibrary.placeText(slideLibrary.title(), slideLibrary.getPage());
                            key.setScope('text-entry');
                            key.filter = key.filters['text-entry'];
                        } else if (!isUsingEraser) {
                            overlayLibrary.replaceNote('latest', slideLibrary.title(), slideLibrary.getPage());
                        }
                    } else if (isTargetTextHandle) {
                        let domTextBox = d3Target.node().parentNode;
                        overlayLibrary.startDragTextbox(domTextBox);
                    }
                } // start drawing a shape
            } else { // replace is turned off
                if (isTargetTextInput) {
                    overlayLibrary.setActiveText(d3Target.node());
                    key.setScope('text-entry');
                    key.filter = key.filters['text-entry'];
                } else { // nothing, shape, or handle is here
                    if (hasSelectedTextTool) {
                        if (!isTargetTextHandle) {
                            overlayLibrary.removeActiveText();
                            overlayLibrary.placeText(slideLibrary.title(), slideLibrary.getPage());
                            key.setScope('text-entry');
                            key.filter = key.filters['text-entry'];
                        } else if (isTargetTextHandle) {
                            let domTextBox = d3Target.node().parentNode;
                            overlayLibrary.startDragTextbox(domTextBox);
                        }
                    } // start drawing a shape
                }
            }
        },
        'mouseup': function (event) {
            let hasClickedLeftMouseButton = _.isEqual(event.which, 1);
            if (!hasClickedLeftMouseButton) {
                return true;
            }
            //-------------------------------------------------------
            let d3Target = d3.select(event.target);
            let hasSelectedTextTool = _.isEqual(Session.get('overlay.tool'), 'text');
            let isTargetTextInput = d3Target.classed('annotation-text-input');
            let isTargetTextHandle = d3Target.classed('annotation-text-handle');
            if ((!hasSelectedTextTool && !isTargetTextInput && !isTargetTextHandle)) {
                Session.set('draw', false);
                switch (Session.get('overlay.tool')) {
                    case 'line':
                        overlayLibrary.markLineEnd(event);
                        overlayLibrary.markLine(slideLibrary.title(), slideLibrary.getPage(), event);
                        break;
                    case 'arrow':
                        overlayLibrary.markArrowEnd(event);
                        overlayLibrary.markArrow(slideLibrary.title(), slideLibrary.getPage(), event);
                        break;
                    case 'rect':
                        overlayLibrary.markBoxCorner(event);
                        overlayLibrary.recoordinateBox(event);
                        overlayLibrary.markBox(slideLibrary.title(), slideLibrary.getPage(), event);
                        break;
                    case 'ellipse':
                        overlayLibrary.markEllipseCorner(event);
                        overlayLibrary.recoordinateEllipse(event);
                        overlayLibrary.markEllipse(slideLibrary.title(), slideLibrary.getPage(), event);
                        break;
                    case 'pencil':
                        overlayLibrary.markSquiggle(slideLibrary.title(), slideLibrary.getPage(), event);
                        break;
                    case 'erase':
                        overlayLibrary.deactivateEraser();
                        break;
                }
            }
        },
        'mouseover .annotation-text-handle': function (event) {
            let jqTextbox = $(event.target).parent().get(0);
            overlayLibrary.startDragTextbox(jqTextbox);
        },
        'mouseout .annotation-text-handle': function (event) {
            let jqTextbox = $(event.target).parent().get(0);
            overlayLibrary.stopDragTextbox(jqTextbox);
        },
        'mouseup .annotation-text-handle': function (event) {
            let jqTextHandle = $(event.target);
            let jqTextBox = jqTextHandle.parent();
            let jqTextInput = jqTextBox.find('.annotation-text-input').first();
            overlayLibrary.storeTextbox(slideLibrary.title(), slideLibrary.getPage(), jqTextInput.get(0));
        },
        'keyup .annotation-text-input, mouseup .annotation-text-input': function (event) {
            let domTextInput = event.target;
            overlayLibrary.autosizeTextbox(domTextInput);
        },
        'mouseover': function (event) {
            changeCursor();
        },
        'mouseexit': function (event) {
            $('#overlay').css('cursor', '');
        },
        /*'click .annotation': function(event){
         // TODO - this event isn't working; logical error somewhere
         // use mousedown then mouseover to erase
         if (_.isEqual( Session.get('overlay.tool'), 'erase' ) ){
         overlayLibrary.activateEraser(event, slideLibrary.title(), slideLibrary.getPage());
         }
         },*/
        'mousedown': function (event) {
            let hasClickedLeftMouseButton = _.isEqual(event.which, 1);
            if (!hasClickedLeftMouseButton) {
                return true;
            }
            //-------------------------------------------------------
            let d3Target = d3.select(event.target);
            let isReplaceOn = Session.get('overlay.tool.replace');
            let isUsingEraser = _.isEqual(Session.get('overlay.tool'), 'erase');
            let hasSelectedTextTool = _.isEqual(Session.get('overlay.tool'), 'text');
            let isTargetTextInput = d3Target.classed('annotation-text-input');
            let isTargetTextHandle = d3Target.classed('annotation-text-handle');
            overlayLibrary.storeActiveTextInputs(slideLibrary.title(), slideLibrary.getPage());
            key.filter = key.filters['all'];
            key.setScope('keyboard-shortcuts');
            if (isReplaceOn && !isUsingEraser) {
                overlayLibrary.replaceNote('previous', slideLibrary.title(), slideLibrary.getPage());
            }
            if ((!isTargetTextInput && !isTargetTextHandle && !hasSelectedTextTool)) {
                Session.set('draw', true);
                if (_.isEqual(Session.get('overlay.tool'), 'line')) {
                    overlayLibrary.markLineStart(event);
                }
                if (_.isEqual(Session.get('overlay.tool'), 'arrow')) {
                    overlayLibrary.markArrowStart(event);
                }
                if (_.isEqual(Session.get('overlay.tool'), 'rect')) {
                    overlayLibrary.markBoxOrigin(event);
                }
                if (_.isEqual(Session.get('overlay.tool'), 'ellipse')) {
                    overlayLibrary.markEllipseOrigin(event);
                }
                if (_.isEqual(Session.get('overlay.tool'), 'pencil')) {
                    overlayLibrary.markSquiggleStart(event);
                }
                if (_.isEqual(Session.get('overlay.tool'), 'erase')) {
                    overlayLibrary.activateEraser(slideLibrary.title(), slideLibrary.getPage());
                }
            }
        },
        'mousemove': function (event) {
            overlayLibrary.createLocalSpace(event);
            if (Session.get('draw')) {
                if (_.isEqual(Session.get('overlay.tool'), 'line')) {
                    overlayLibrary.markLineEnd(event);
                    overlayLibrary.placeLine(event);
                }
                if (_.isEqual(Session.get('overlay.tool'), 'arrow')) {
                    overlayLibrary.markArrowEnd(event);
                    overlayLibrary.placeArrow(event);
                }
                if (_.isEqual(Session.get('overlay.tool'), 'rect')) {
                    overlayLibrary.markBoxCorner(event);
                    overlayLibrary.recoordinateBox(event);
                    overlayLibrary.placeBox(event);
                }
                if (_.isEqual(Session.get('overlay.tool'), 'ellipse')) {
                    overlayLibrary.markEllipseCorner(event);
                    overlayLibrary.recoordinateEllipse(event);
                    overlayLibrary.placeEllipse(event);
                }
                if (_.isEqual(Session.get('overlay.tool'), 'pencil')) {
                    overlayLibrary.placeSquiggle(event);
                }
            }
        }
    });
} 