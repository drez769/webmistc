SlideLibrary = function (_title) {
    var title = _title;
    PDFJS.workerSrc = '/packages/pascoual_pdfjs/build/pdf.worker.js';
    var self = this;
    var slides;
    create();


    function create() {
        $('#slide').append('<canvas id="slide-canvas"> </canvas>');
    };


    function updatePage(number) {
        //console.error('update page: ' + number);
        Session.set('slide.page', number);
        Meteor.call('slides.change', self.title(), number);
        Meteor.call('recordings.insert', {
            state: 'session',
            action: 'slide.page',
            params: [number],
            time: Date.now(),
        });
        Meteor.call('recordings.insert', {
            state: 'database',
            action: 'slides.change',
            params: [self.title(), number],
            time: Date.now(),
        });
    }

    self.clear = function () {
        $('#slide-canvas').remove();
        create();
    };

    self.title = function () {
        return title;
    };

    self.set = function (_slides) {
        slides = _slides;
    };
    self.get = function () {
        return slides;
    };
    self.getPage = function (request) {
        var number = Session.get('slide.page');
        return Number(number);
    }

    self.setPage = function (number) {
        updatePage(number);
    }

    self.render = function (request) {
        if (slides) {
            self.clear();
            var number = self.getPage();
            slides.getPage(number).then(function (page) {
                //updatePage(number);
                var scale = 3;
                var viewport = page.getViewport(scale);
                // Prepare canvas using slide page dimensions
                var canvas = $('#slide-canvas')[0];
                var context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                // Render slide page into canvas context
                page.render({canvasContext: context, viewport: viewport}).promise.then(function () {
                });
            });
        }
    }
}