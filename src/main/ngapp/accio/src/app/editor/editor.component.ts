import { Component, OnInit } from '@angular/core';
import { ViewChild, ElementRef } from '@angular/core';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { FormGroup, FormControl } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PostBlobsService } from '../post-blobs.service';
import { FetchImagesService } from '../fetch-images.service';
import { MagicWandService } from './magic-wand.service';
import { ImageBlob } from '../ImageBlob';
import { MaskTool } from './MaskToolEnum';
import { Coordinate } from './Coordinate';
import * as $ from 'jquery';
import { MaskAction, Action, Tool } from './mask-action';
import { MaskControllerService } from './mask-controller.service';
import { PreviewMask } from './magic-wand.service';
import { Zoom, UndoRedo, SwitchImage } from '../enums';

@Component({
  selector: 'app-editor',
  templateUrl: './editor.component.html',
  styleUrls: ['./editor.component.css'],
})
export class EditorComponent implements OnInit {
  mySubscription: any;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private magicWandService: MagicWandService,
    private postBlobsService: PostBlobsService,
    private fetchImagesService: FetchImagesService,
    private maskControllerService: MaskControllerService,
    private snackBar: MatSnackBar
  ) {
    //  Tells Router to not reuse route so when url is changed,
    //    reloads component with new url info.
    this.router.routeReuseStrategy.shouldReuseRoute = function () {
      return false;
    };

    //  If the current route ends (ie url changes) trick router to believe it wasn't loaded
    //    in order to reload the component.
    this.mySubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.router.navigated = false;
      }
    });
  }

  // Cursor varaibles.
  cursorX = 0;
  cursorY = 0;

  // Preview-floodfill variables.
  private previewMaster: PreviewMask = new PreviewMask(0);
  private previewImgData: ImageData;
  private curMaskAction: MaskAction;
  private continuePreview = false;
  isPreview = false;

  // Display variables.
  private image: HTMLImageElement;
  private maskImageData: ImageData;
  private imageUrl: string;
  index: number;
  maskIndex: number;
  displayMaskForm: boolean = false;
  disableSubmit: boolean = false;

  allPixels: Set<number>;

  stageWidth: number;
  stageHeight: number;
  brushWidth: number;

  MAGENTA: string = 'rgba(255, 0, 255, 1)';
  DESTINATION_OUT: string = 'destination-out';
  SOURCE_OVER: string = 'source-over';

  // Form variables.
  uploadMaskForm: FormGroup;
  formData: FormData;
  projectId: string;
  parentName: string;
  maskUrl: string;
  blobMask: Blob;

  // Need the image's name for updates
  imgName: string;

  // scaleFactor is used to trim image scale so image
  //   is smaller than width and height of the user's screen.
  // The following variables are bound to their
  //   respective inputs in MaskDirective and change in mask.directive
  //   when they change in editor.component
  scaleFactor: number;
  originalImageData: ImageData;
  tolerance: number;
  maskAlpha: number;
  disableFloodFill: boolean;
  // Hold user's click position
  private startPixel: Coordinate;

  //  Declares the type of tool the user has selected from the tool bar:
  //      'magic-wand' = flood fill algorithm enabled.
  //      'mask-only' = user sees only the mask and cannot use the magic wand tool.
  maskTool: MaskTool;

  //  Stores image that user queued from img-Gallery for next and prev arrows.
  //  Array<any> because info comes from survlet as json array
  imageArray: Array<Object>;

  // The coordinates in the destination canvas at which to place
  //   the top-left corner of the source image. inputed from maskDirective
  destinationCoords: Coordinate;

  // Rectangle used when user goes to paint or scribble paint as search box.
  private searchRectangle: Rectangle;

  // Inject canvas from html.
  @ViewChild('scaledCanvas', { static: true })
  scaledCanvas: ElementRef<HTMLCanvasElement>;
  private scaledCtx: CanvasRenderingContext2D;

  // Overlays a layer just for showing the preview of the mask.
  // Once the preview is committed, this canvas is cleared and
  // the chosen preview is painted on the scaledCanvas as well
  // as committed to the maskCanvas.
  @ViewChild('previewCanvas', { static: true })
  previewCanvas: ElementRef<HTMLCanvasElement>;
  private previewCtx: CanvasRenderingContext2D;

  // Overlays custom "cursor" that changes based on brush size.
  @ViewChild('cursorCanvas', { static: true })
  cursorCanvas: ElementRef<HTMLCanvasElement>;
  private cursorCtx: CanvasRenderingContext2D;

  //  Holds static user image for background.
  @ViewChild('imageCanvas', { static: true })
  imageCanvas: ElementRef<HTMLCanvasElement>;
  private imageCtx: CanvasRenderingContext2D;

  //  Unscaled canvas that is used to save mask
  //    as the same size as its image.
  @ViewChild('maskCanvas', { static: true })
  maskCanvas: ElementRef<HTMLCanvasElement>;
  private maskCtx: CanvasRenderingContext2D;

  @ViewChild('paintCanvas', { static: true })
  paintCanvas: ElementRef<HTMLCanvasElement>;
  private paintCtx: CanvasRenderingContext2D;

  ngOnInit() {
    this.image = new Image();
    this.scaleFactor = 0.9;
    this.tolerance = 30;
    this.maskAlpha = 1;
    this.disableFloodFill = false;
    this.maskTool = MaskTool.MAGIC_WAND_ADD;
    this.brushWidth = 5;
    this.destinationCoords = new Coordinate(0, 0);
    document.body.classList.remove('busy-cursor');

    //  Gets last image array that user sorted on img-gallery page. Saves to session storage to keep through refresh.
    //  If gallery reloaded a new Image array, newArray is set to true to signify the need to re-fetch array.
    if (
      !window.sessionStorage.getItem('imageArray') ||
      this.fetchImagesService.newArray
    ) {
      this.fetchImagesService.currentImages.subscribe(
        (newImages) => (this.imageArray = newImages)
      );
      window.sessionStorage.setItem(
        'imageArray',
        JSON.stringify(this.imageArray)
      );
      //  Images have been re-fetched, set new to false.
      this.fetchImagesService.newArray = false;
    } else {
      this.imageArray = JSON.parse(window.sessionStorage.getItem('imageArray'));
    }

    this.route.paramMap.subscribe((params) => {
      this.imgName = params.get('img-name ');
      this.projectId = params.get('proj-id ');
      this.parentName = params.get('parent-img ');
      this.imageUrl = params.get('img-url ');
      this.maskUrl = params.get('mask-url ');

      try {
        this.index = Number(params.get('index '));
        if (params.get('mask-index')) {
          this.maskIndex = Number(params.get('mask-index'));
        }
      } catch {
        console.log(
          `index: ${params.get('index ')} or ${params.get(
            'mask-index'
          )} could not be parsed as number.`
        );
        this.index = 0;
        if (params.get('mask-index')) {
          this.maskIndex = 0;
        }
        this.router.navigate([`img-gallery/${this.projectId}`]);
      }
    });

    //  Image loads after src is set, ensures canvas is initialized properly.
    this.image.onload = () => {
      this.initCanvas();
    };
    this.image.src = this.imageUrl;

    // Initializes mask upolad form.
    this.initMaskForm();

    // Fetch blob for mask upload and show maskUploadForm.
    this.postBlobsService.fetchBlob();
    this.displayMaskForm = true;

    // Alert user before they leave page if they modified a mask.
    window.addEventListener('beforeunload', (e) => {
      if (this.maskControllerService.isSaved()) {
        return undefined;
      }
      let confirmationMessage = 'Changes you made may not be saved';

      (e || window.event).returnValue = confirmationMessage; //Gecko + IE
      return confirmationMessage; //Gecko + Webkit, Safari, Chrome etc.
    });
  }

  /** Unsubscribe from subscription when component reloaded */
  ngOnDestroy() {
    if (this.mySubscription) {
      this.mySubscription.unsubscribe();
    }
  }

  /**
   *  Draws the image user selects from gallery on Canvas
   *    and creates a hidden canvas to store the original image
   *    as a reference when scaling the imageUI.
   *  Assumes Image has loaded, i.e. image src is set before initCanvas
   *    is called (using onload).
   */
  private initCanvas() {
    let imgWidth = this.image.width;
    let imgHeight = this.image.height;

    // Initialize transparent black image data to use for mask size of image
    this.maskImageData = new ImageData(imgWidth, imgHeight);

    // Set initial canvas height based on the window and image height and scaleFactor
    //   of .9 to make the image smaller than the screen.
    this.scaleFactor *= window.innerHeight / this.image.height;
    // Updates canvas scale initially so the entire image is on the canvas, zoom = 1.
    this.setScaleFactor();
    // if scale is < .01, just set the scale manually
    if (this.scaleFactor <= 0) {
      this.scaleFactor = 0.01;
    }

    // Canvas to draw mask, hidden.
    this.maskCanvas.nativeElement.width = imgWidth;
    this.maskCanvas.nativeElement.height = imgHeight;
    this.maskCtx = this.maskCanvas.nativeElement.getContext('2d');
    this.maskCtx.lineCap = this.maskCtx.lineJoin = 'round';
    this.maskCtx.strokeStyle = this.MAGENTA;

    this.paintCanvas.nativeElement.width = imgWidth;
    this.paintCanvas.nativeElement.height = imgHeight;
    this.paintCtx = this.paintCanvas.nativeElement.getContext('2d');
    this.paintCtx.lineCap = this.paintCtx.lineJoin = 'round';
    this.paintCtx.strokeStyle = this.MAGENTA;

    // Canvas to show mask scaled.
    this.scaledCanvas.nativeElement.width = imgWidth * this.scaleFactor;
    this.scaledCanvas.nativeElement.height = imgHeight * this.scaleFactor;
    this.scaledCtx = this.scaledCanvas.nativeElement.getContext('2d');

    // Canvas to show preview of floodfills.
    this.previewCanvas.nativeElement.width = imgWidth * this.scaleFactor;
    this.previewCanvas.nativeElement.height = imgHeight * this.scaleFactor;
    this.previewCtx = this.previewCanvas.nativeElement.getContext('2d');

    // Canvas to show Image (never changes unless user only wants to see Mask)
    this.imageCanvas.nativeElement.width = imgWidth * this.scaleFactor;
    this.imageCanvas.nativeElement.height = imgHeight * this.scaleFactor;
    this.imageCtx = this.imageCanvas.nativeElement.getContext('2d');

    // Canvas to paint cursor-overlay of brush size.
    this.cursorCanvas.nativeElement.width = imgWidth * this.scaleFactor;
    this.cursorCanvas.nativeElement.height = imgHeight * this.scaleFactor;
    this.cursorCtx = this.cursorCanvas.nativeElement.getContext('2d');

    this.stageWidth = imgWidth * this.scaleFactor;
    this.stageHeight = imgHeight * this.scaleFactor;

    //   Draws image non scaled on full canvas
    this.maskCtx.drawImage(this.image, 0, 0);

    //  Only gets the image data from (0,0) to (width,height) of image.
    this.originalImageData = this.maskCtx.getImageData(
      0,
      0,
      imgWidth,
      imgHeight
    );
    this.maskCtx.clearRect(0, 0, imgWidth, imgHeight);

    this.drawScaledImage(this.destinationCoords.x, this.destinationCoords.y);

    // If there is a mask URL passed in then draw mask.
    if (this.maskUrl != '' && this.maskUrl) {
      let maskImage = new Image();
      maskImage.onload = () => {
        this.maskCtx.drawImage(maskImage, 0, 0);
        this.maskImageData = this.maskCtx.getImageData(
          0,
          0,
          imgWidth,
          imgHeight
        );

        this.drawMask(this.destinationCoords.x, this.destinationCoords.y);
        this.initMaskSet();
      };
      maskImage.src = this.maskUrl;
    }

    let totalNumPixels = this.originalImageData.data.length / 4;
    this.allPixels = new Set([
      ...Array.from(Array(totalNumPixels).keys()).map(
        // Multiplies every value in the pixel array by 4 to obtain
        // the indices of the pixels within the RBGA array
        function (x) {
          return x * 4;
        }
      ),
    ]);
  }

  /** Used to initialize mask controller with image's mask if one exists. */
  initMaskSet() {
    let maskSet = new Set<number>();
    for (let i = 0; i < this.maskImageData.data.length; i += 4) {
      if (this.maskImageData.data[i + 3] === 255) {
        maskSet.add(i);
      }
    }
    this.maskControllerService = new MaskControllerService(maskSet);
  }

  /**
   * Creates a new scaleFactor depending on zoom and image height and width
   * @param zoom is the amount the scale should zoom in or out, if there's
   *   no value given, then zoom defaults to none.
   */

  setScaleFactor(zoom: number = 1) {
    this.scaleFactor *= zoom;
    try {
      this.scaleFactor = Number(this.scaleFactor.toFixed(2));
    } catch {
      this.scaleFactor = 1;
      console.log(
        `scale factor: ${this.scaleFactor.toFixed(
          2
        )} could not be converted to number`
      );
    }
  }

  /* The following 2 functions: Handles cursor tracking and resizing. */

  // Draws/Redraws 'cursor' at the current position of user's mouse.
  setCursorPosition(e: MouseEvent): void {
    // These are the coordinates used to paint.
    this.cursorX = e.offsetX;
    this.cursorY = e.offsetY;

    this.cursorCtx.clearRect(0, 0, this.stageWidth, this.stageHeight);

    this.cursorCtx.beginPath();
    this.cursorCtx.arc(
      this.cursorX,
      this.cursorY,
      this.brushWidth * this.scaleFactor * 0.5,
      0,
      2 * Math.PI,
      true
    );
    this.cursorCtx.fillStyle = 'rgba(255, 0, 0, .5)';
    this.cursorCtx.strokeStyle = 'black';
    this.cursorCtx.stroke();
    this.cursorCtx.fill();
  }

  // Clears the 'cursor' when the mouse leaves the editing area.
  setCursorOut(): void {
    this.cursorCtx.clearRect(0, 0, this.stageWidth, this.stageHeight);
  }

  /**
   * Clears full canvas.
   */
  private clearScaledCanvas() {
    this.scaledCtx.clearRect(
      0,
      0,
      this.scaledCanvas.nativeElement.width,
      this.scaledCanvas.nativeElement.height
    );
  }

  /**
   *  Draws user's image scaled to canvas and restores ctx.
   *  @param dx The x-axis coordinate in the destination canvas
   *    at which to place the top-left corner of the source image.
   *  @param dy The y-axis coordinate in the destination canvas
   *    at which to place the top-left corner of the source image.
   */
  private drawScaledImage(dx: number, dy: number) {
    this.imageCtx.clearRect(
      0,
      0,
      this.imageCanvas.nativeElement.width,
      this.imageCanvas.nativeElement.height
    );
    this.imageCtx.save();
    this.imageCtx.scale(this.scaleFactor, this.scaleFactor);
    this.imageCtx.drawImage(
      this.image,
      dx,
      dy,
      this.image.width,
      this.image.height
    );
    this.imageCtx.restore();
  }

  /**
   *  Makes a bitmap of mask, clears canvas, draws the original image and draws the mask.
   *  Executes all three functions after image loads so 'jolt' of canvas erase and draw is less extreme.
   *  Disables Flood fill before maskUrl is being set so new data isn't added
   *  class @param this.disableSubmit set to true before mask loaded because maskUrl is being updated.
   *  @param dx The x-axis coordinate in the destination canvas
   *    at which to place the top-left corner of the source image.
   *  @param dy The y-axis coordinate in the destination canvas
   *    at which to place the top-left corner of the source image.
   */
  private drawMask(dx: number, dy: number) {
    this.clearScaledCanvas();
    createImageBitmap(this.maskImageData).then((renderer) => {
      this.scaledCtx.save();
      this.scaledCtx.scale(this.scaleFactor, this.scaleFactor);
      this.scaledCtx.globalAlpha = this.maskAlpha;
      this.scaledCtx.drawImage(
        renderer,
        dx,
        dy,
        this.image.width,
        this.image.height
      );
      this.scaledCtx.restore();
    });
  }

  /**
   * Initializes Form group and data as new
   * Initializes @param projectId
   */
  private initMaskForm() {
    this.uploadMaskForm = new FormGroup({
      maskName: new FormControl(),
      tags: new FormControl(),
    });
    this.formData = new FormData();
  }

  /**
   * Builds ImageBlob to be appended to form and posted.
   */
  async onSubmit(): Promise<void> {
    //  Name is a required input. If it's null, do nothing.
    if (!this.uploadMaskForm.get('maskName').value) {
      return;
    }

    await this.getMaskBlob();

    let imageBlob = new ImageBlob(
      this.projectId,
      /*imageName=*/ this.uploadMaskForm.get('maskName').value,
      /*mode=*/ 'create',
      /*image=*/ this.blobMask,
      /*parentImageName=*/ this.parentName,
      /*newImageName=*/ '',
      /*tags=*/ this.uploadMaskForm.get('tags').value
    );

    this.postBlobsService.buildForm(
      this.formData,
      imageBlob,
      this.parentName + 'Mask.png'
    );

    this.maskControllerService.save();

    //  Reset form values
    this.initMaskForm();
  }

  async onClickSaveButton(): Promise<void> {
    await this.getMaskBlob();

    let imageBlob = new ImageBlob(
      this.projectId,
      /*imageName=*/ this.imgName,
      /*mode=*/ 'update',
      /*image=*/ this.blobMask,
      /*parentImageName=*/ this.parentName,
      /*newImageName=*/ undefined,
      /*tags=*/ undefined
    );

    this.postBlobsService.buildForm(
      this.formData,
      imageBlob,
      this.parentName + 'Mask.png'
    );

    this.maskControllerService.save();

    //  Reset form values
    this.formData = new FormData();
  }
  /**
   *  Gets current mask's url and sets the mask as a Blob to be uploaded to server.
   */
  async getMaskBlob(): Promise<void> {
    this.blobMask = await fetch(this.getMaskUrl()).then((response) =>
      response.blob()
    );
  }

  /**
   *  Draws Mask Data onto unscaled canvas to save as image or blob.
   *  @returns url of newly created mask.
   */
  getMaskUrl(): string {
    this.maskCtx.clearRect(
      0,
      0,
      this.maskCanvas.nativeElement.width,
      this.maskCanvas.nativeElement.height
    );
    this.maskCtx.beginPath();
    this.maskCtx.putImageData(this.maskImageData, 0, 0);
    return this.maskCanvas.nativeElement.toDataURL();
  }

  /**
   *  Returns the RouterLink for the next or previous image in the user's last selection
   *    of gallery images. If the user clicked on a specific mask, returns the next mask.
   *  @param previous signifies whether the user has selected the previous image button.
   */
  switchImage(direction: SwitchImage) {
    // If user clicks on an image's mask, then newImage will loop through all the image's masks.
    if (this.maskIndex === 0 || this.maskIndex) {
      let maskObject = this.imageArray[this.index]['masks'];
      if (direction === SwitchImage.PREVIOUS) {
        this.maskIndex - 1 < 0
          ? (this.maskIndex = maskObject.length - 1)
          : --this.maskIndex;
      } else {
        this.maskIndex + 1 >= maskObject.length
          ? (this.maskIndex = 0)
          : ++this.maskIndex;
      }
      let nextMask = this.imageArray[this.index]['masks'][this.maskIndex];
      this.router.navigate([
        '/editor',
        this.projectId,
        this.parentName,
        this.imageUrl,
        this.imgName,
        nextMask['url'],
        this.index,
        this.maskIndex,
      ]);
    }
    //  Otherwise, newImage loops through the images last fetched in the imageArray
    else {
      if (direction === SwitchImage.PREVIOUS) {
        this.index - 1 < 0
          ? (this.index = this.imageArray.length - 1)
          : --this.index;
      } else {
        this.index + 1 >= this.imageArray.length
          ? (this.index = 0)
          : ++this.index;
      }
      let nextImage = this.imageArray[this.index];
      this.router.navigate([
        '/editor',
        this.projectId,
        nextImage['name'],
        nextImage['url'],
        this.imgName,
        this.getFirstMask(nextImage['masks']),
        this.index,
      ]);
    }
  }

  /** Helper function to get the first mask in an image's mask, to be drawn if a selected image has an existing mask. */
  getFirstMask(mask: Object): string {
    if (mask[0]) {
      return mask[0]['url'];
    }
    console.log('no url found');
    return '';
  }

  /** FUNCTIONS CALLED FROM EMITTED EVENTS */

  /**
   *  Sets all pixels to magenta and inverts their alpha to display them or not.
   *  Disables flood fill and submit to avoid conflict as mask updates.
   *  class @param this.disableSubmit set equal to true before pixels updated
   *    so submit isn't called before mask is drawn and url is updated.
   *  class @param this.disableFloodFill must equal true before called because
   *    maskImageData is being updated. Only switched to false if user tool is 'magic-wand'
   *    (flood fill not allowed any other time).
   *  Called when invert event is emitted from top toolbar
   */
  invertMask() {
    this.disableSubmit = this.disableFloodFill = true;
    this.maskControllerService.do(
      new MaskAction(Action.INVERT, Tool.INVERT, this.allPixels)
    );
    this.setMaskTo(this.maskControllerService.getMask());
    this.drawMask(this.destinationCoords.x, this.destinationCoords.y);
    if (
      this.maskTool === MaskTool.MAGIC_WAND_ADD ||
      this.maskTool === MaskTool.MAGIC_WAND_SUB
    ) {
      this.disableFloodFill = false;
    }
    this.disableSubmit = false;
  }

  /**
   *  Called when event is clearEvent is emitted from top-toolbar. Clears canvas of old mask.
   *  Clears old image data. Disables submit while mask is updating.
   *  class @param this.disableFloodFill must equal true before called because
   *     maskImageData is being updated. Only switched to false if user tool is 'magic-wand'
   *     (flood fill not allowed any other time).
   */
  clearMask() {
    this.disableFloodFill = true;
    this.maskImageData = new ImageData(this.image.width, this.image.height);
    this.clearScaledCanvas();

    this.maskControllerService.do(
      new MaskAction(
        Action.CLEAR,
        Tool.CLEAR,
        this.maskControllerService.getMask()
      )
    );
    this.disableSubmit = false;
    if (
      this.maskTool === MaskTool.MAGIC_WAND_ADD ||
      this.maskTool === MaskTool.MAGIC_WAND_SUB
    ) {
      this.disableFloodFill = false;
    }
  }

  /**
   * Undoes or redoes what the user had previously marked. Event emitted by top-toolbar or
   * called based on key presses.
   */
  undoRedo(direction: UndoRedo): void {
    this.disableSubmit = this.disableFloodFill = true;
    direction === UndoRedo.UNDO
      ? this.maskControllerService.undo()
      : this.maskControllerService.redo();
    this.setMaskTo(this.maskControllerService.getMask());
    this.drawMask(this.destinationCoords.x, this.destinationCoords.y);
    this.disableSubmit = this.disableFloodFill = false;
  }

  /** Sets editors image data to new mask generated by maskController, either undo/redo or invert. */
  setMaskTo(pixels: Set<number>): void {
    this.maskImageData = new ImageData(this.image.width, this.image.height);
    for (let pixel of pixels) {
      this.maskImageData.data[pixel] = 255;
      this.maskImageData.data[pixel + 2] = 255;
      this.maskImageData.data[pixel + 3] = 255;
    }
  }

  /**
   *  Updates the value of the Toolbar toggle group.
   *  If the tool is switching from maskOnly, then it redraws the image on the imageCanvas.
   */
  updateMaskTool(tool: string) {
    //  All cases beside 'magic-wand' must disableFloodFill.
    this.disableFloodFill = true;
    if (this.maskTool === MaskTool.MASK_ONLY) {
      this.drawScaledImage(this.destinationCoords.x, this.destinationCoords.y);
    }
    switch (tool) {
      case MaskTool.MAGIC_WAND_ADD:
        this.maskTool = MaskTool.MAGIC_WAND_ADD;
        this.disableFloodFill = false;
        break;
      case MaskTool.MAGIC_WAND_SUB:
        this.maskTool = MaskTool.MAGIC_WAND_SUB;
        break;
      case MaskTool.PAINT:
        this.maskTool = MaskTool.PAINT;
        break;
      case MaskTool.ERASE:
        this.maskTool = MaskTool.ERASE;
        break;
      case MaskTool.PAN:
        this.maskTool = MaskTool.PAN;
        break;
      case MaskTool.MASK_ONLY:
        this.maskTool = MaskTool.MASK_ONLY;
        this.imageCtx.clearRect(
          0,
          0,
          this.imageCanvas.nativeElement.width,
          this.imageCanvas.nativeElement.height
        );
        break;
    }
  }

  /**  Retrieves new tolerance value from event emitted by child component: toolbar. */
  updateTolerance(value: number) {
    this.tolerance = value;
  }

  /**
   *  Retrieves new alpha value from child component toolbar and draws mask with new alpha.
   *  The alpha value cannot be larger than 1 or less than 0, so the value is adjusted to fit in range.
   */
  updateMaskAlpha(value: number) {
    this.maskAlpha = Math.min(Math.max(value, 0.0), 1.0);
    //  Draw mask with new maskAlpha value.
    this.disableFloodFill = true;
    this.drawMask(this.destinationCoords.x, this.destinationCoords.y);
    if (
      this.maskTool === MaskTool.MAGIC_WAND_ADD ||
      this.maskTool === MaskTool.MAGIC_WAND_SUB
    ) {
      this.disableFloodFill = false;
    }
  }

  /** Recieves new width from event emitted by child component: toolbar. */
  updateBrushWidth(width: number) {
    this.brushWidth = width;
  }

  /**
   *  Sets new pixels in magenta, clears canvas of previous data
   *    and draws image and mask as scaled. Disables submit
   *    on mask until the url is set.
   *  class @param this.disableFloodFill must equal true before pixels updated
   *    so another floodfill isn't called before one finishes.
   *  class @param this.disableSubmit set equal to true before pixels updated
   *    so submit isn't called before mask is drawn and url is updated.
   *  class @param maskPixels event Output() from mask.directive
   *    Gives the new pixels to add to the mask
   *  Only returned when maskTool is 'magic-wand', no need to check maskTool
   */
  floodfillMask(maskAction: MaskAction): void {
    this.disableSubmit = this.disableFloodFill = true;
    // Case 1: performs preview-floodfill sequence.
    if (maskAction.previewMaster.getIsPreview()) {
      // Pauses any other canvas-editting sequences from registering
      // on the canvas.
      const previewLayer = document.getElementById('preview-layer');
      previewLayer.style.pointerEvents = 'auto';

      // Remembers the maskAction for when the preview is committed.
      this.curMaskAction = maskAction;

      this.previewMaster.masksByTolerance =
        maskAction.previewMaster.masksByTolerance;

      // Activates updatePreview(), which is always called by a change in the
      // mat-slider, but only accepts the call if the floodfill preview sequence
      // is initiated.
      this.continuePreview = true;
      this.updatePreview();

      // Pops up a snackbar to tell the user what to do next.
      this.openPreviewSnackBar();
    } else {
      // Case 2: Performs basic floodfill sequence.
      //  Changes if set of pixels are added or removed from the mask depending on the tool.
      let alphaValue = this.maskTool === MaskTool.MAGIC_WAND_ADD ? 255 : 0;

      for (let pixel of maskAction.getChangedPixels()) {
        this.maskImageData.data[pixel] = 255;
        this.maskImageData.data[pixel + 2] = 255;
        this.maskImageData.data[pixel + 3] = alphaValue;
      }
      if (maskAction.getActionType() == Action.SUBTRACT) {
        this.maskControllerService.do(maskAction, this.allPixels);
      } else {
        this.maskControllerService.do(maskAction);
      }
      this.drawMask(this.destinationCoords.x, this.destinationCoords.y);
      this.disableSubmit = this.disableFloodFill = false;
    }
  }

  // User must confirm the preview and commit it to the mask before
  // the preview-sequence can end.
  openPreviewSnackBar() {
    let snackBarRef = this.snackBar.open(
      /*message=*/ 'Blocking: Please confirm the floodfill on this preview!',
      /*action-message=*/ 'Confirm!',
      { horizontalPosition: 'left', verticalPosition: 'top' }
    );

    snackBarRef.afterDismissed().subscribe(() => {
      this.endPreview();
    });
  }

  /**Called whenever tolerance input changes. Only executes on a new
   * preview mask event;
   * newMaskEvent >> floodfillMask() { execute: else block }.
   */
  updatePreview(): void {
    if (this.continuePreview) {
      this.previewImgData = new ImageData(this.image.width, this.image.height);
      this.previewMaster.changeMaskBy(this.tolerance);

      for (let pixel of this.previewMaster.getMaskAsArray()) {
        this.previewImgData.data[pixel] = 255;
        this.previewImgData.data[pixel + 2] = 255;
        this.previewImgData.data[pixel + 3] = 255;
      }

      this.drawPreview();
    }
  }

  /**Called when a new preview mask sequence and the tolerance input
   * has been confirmed.
   */
  endPreview(): void {
    if (this.continuePreview) {
      this.continuePreview = false;
      this.clearPreviewCanvas();

      for (let pixel of this.previewMaster.getMaskAsArray()) {
        this.maskImageData.data[pixel] = 255;
        this.maskImageData.data[pixel + 2] = 255;
        this.maskImageData.data[pixel + 3] = 255;
      }

      // Updates curMaskAction to hold the changedPixels,
      // and pass them into maskController.
      this.curMaskAction.commitPreviewPixels(this.previewMaster.getMaskAsSet());
      this.previewMaster.resetMask();
      if (this.curMaskAction.getActionType() == Action.SUBTRACT) {
        this.maskControllerService.do(this.curMaskAction, this.allPixels);
      } else {
        this.maskControllerService.do(this.curMaskAction);
      }
      this.drawMask(this.destinationCoords.x, this.destinationCoords.y);
      this.disableSubmit = this.disableFloodFill = false;

      // Unpauses other canvas-editing sequences from registering
      // on the canvas.
      const previewLayer = document.getElementById('preview-layer');
      previewLayer.style.pointerEvents = 'none';
    }
  }
  // Redraws the preview mask on the preview canvas.
  private drawPreview(): void {
    this.clearPreviewCanvas();
    this.previewCtx.save();
    this.previewCtx.scale(this.scaleFactor, this.scaleFactor);
    createImageBitmap(this.previewImgData).then((renderer) => {
      this.previewCtx.globalAlpha = this.maskAlpha / 2;
      this.previewCtx.drawImage(
        renderer,
        0,
        0,
        this.previewCanvas.nativeElement.width,
        this.previewCanvas.nativeElement.height
      );
    });
    this.previewCtx.restore();
  }

  private clearPreviewCanvas(): void {
    this.previewCtx.clearRect(
      0,
      0,
      this.previewCanvas.nativeElement.width,
      this.previewCanvas.nativeElement.height
    );
  }

  getIsPreview(isPreview: boolean) {
    this.isPreview = isPreview;
  }

  getFloodfillSet(coord: Coordinate) {
    // Initiates preview-floodfills sequence if preview checkbox is checked
    // and magic wand floodfill('add' option) is selected.
    if (this.isPreview && this.maskTool === MaskTool.MAGIC_WAND_ADD) {
      // TODO: Let user decide tolerance limit
      // (replace hardcoded val 300 with a var).
      const previewMaster: PreviewMask = this.magicWandService.getPreviews(
        this.originalImageData,
        coord.x,
        coord.y,
        /* toleranceLimit= */ 300
      );

      this.floodfillMask(
        new MaskAction(Action.ADD, Tool.MAGIC_WAND, undefined, previewMaster)
      );
    } else {
      // Initiates basic-floodfill sequence.
      const maskSet = this.magicWandService.floodfill(
        this.originalImageData,
        coord.x,
        coord.y,
        this.tolerance
      );
      this.floodfillMask(
        new MaskAction(
          this.maskTool == MaskTool.MAGIC_WAND_ADD
            ? Action.ADD
            : Action.SUBTRACT,
          Tool.MAGIC_WAND,
          maskSet
        )
      );
    }
  }

  // TODO: tolerance over 5/6 tends to add to much to the set and causes 
  //        the program to lag when using scribblefloodfill with user brush size.
  async getScribbleSet(coord: Coordinate): Promise<void> {
    const paintedSet = await this.getPaintedSet();
    const maskSet = this.magicWandService.scribbleFloodfill(
      this.originalImageData,
      coord.x,
      coord.y,
      this.tolerance,
      paintedSet
    );
    this.floodfillMask(
      new MaskAction(
        this.maskTool == MaskTool.MAGIC_WAND_ADD ? Action.ADD : Action.SUBTRACT,
        Tool.SCRIBBLE,
        maskSet
      )
    );
  }

  /**
   *  Sets the start pixel where the users initially clicks the canvas to draw.
   *  @param pixel is the (x,y) coordinate the user first clicks on.
   *  The global composition changes depending on whether the user is painting or erasing.
   *  DESTINATION_OUT for erase, SOURCE_OVER for draw.
   *  Also initializes the paint canvas to paint ONLY the new mask being added for maskController.
   *  We need to capture the pixels erased or painted, paint ctx paints in color,
   *      MaskAction will determine if they're painted or erased with TOOL parameter.
   */
  startDraw(pixel: Coordinate) {
    this.searchRectangle = new Rectangle(
      this.image.width,
      this.image.height,
      this.brushWidth,
      pixel
    );
    this.startPixel = pixel;
    this.maskCtx.clearRect(0, 0, this.image.width, this.image.height);
    this.paintCtx.clearRect(0, 0, this.image.width, this.image.height);
    this.maskCtx.putImageData(this.maskImageData, 0, 0);
    this.maskCtx.globalCompositeOperation =
      this.maskTool === MaskTool.PAINT ||
      this.maskTool === MaskTool.MAGIC_WAND_ADD
        ? this.SOURCE_OVER
        : this.DESTINATION_OUT;
    this.paintCtx.globalCompositeOperation = this.SOURCE_OVER;
  }

  /**
   *  Draws or erases line between previous point user moved over and next point moved over.
   *  Adjusts line width based on user input if user is in paint mode.
   *  @param pixel is emitted after user moves over a new x,y coordinate on the canvas.
   *  Sets this.startPixel to @param pixel to keep continuous drawing line.
   */
  drawPixel(pixel: Coordinate) {
    this.searchRectangle.compareCoordinateToCurrentRectangle(pixel);

    this.maskCtx.beginPath();
    this.paintCtx.beginPath();

    this.maskCtx.lineWidth = this.paintCtx.lineWidth = this.brushWidth;

    this.maskCtx.moveTo(this.startPixel.x, this.startPixel.y);
    this.maskCtx.lineTo(pixel.x, pixel.y);
    this.maskCtx.stroke();

    this.paintCtx.moveTo(this.startPixel.x, this.startPixel.y);
    this.paintCtx.lineTo(pixel.x, pixel.y);
    this.paintCtx.stroke();

    this.startPixel = pixel;
    this.maskImageData = this.maskCtx.getImageData(
      0,
      0,
      this.image.width,
      this.image.height
    );
    this.drawMask(this.destinationCoords.x, this.destinationCoords.y);
  }

  /**
   *  Calls the undo/redo 'do' function with paintedMask: Set of imageData indexes.
   *  TODO: Pass in four pixels that represent the <X, >X, <Y, >Y to not traverse over entire data array
   *  @returns set<number> of all indicies in the mask.
   */
  async getPaintedSet(): Promise<Set<number>> {
    let paintedImageData = this.paintCtx.getImageData(
      0,
      0,
      this.image.width,
      this.image.height
    ).data;
    let paintedMask = new Set<number>();

    let leftTop = this.searchRectangle.getLeftTop();
    let rightBottom = this.searchRectangle.getRightBottom();

    const leftTopIndex = this.magicWandService.coordToDataArrayIndex(
      leftTop.x,
      leftTop.y,
      this.image.width
    );
    const rightBottomIndex = this.magicWandService.coordToDataArrayIndex(
      rightBottom.x,
      rightBottom.y,
      this.image.width
    );
    let currRightTopIndex = this.magicWandService.coordToDataArrayIndex(
      rightBottom.x,
      leftTop.y,
      this.image.width
    );

    let newTopY = leftTop.y;

    for (let i = leftTopIndex; i <= rightBottomIndex; i += 4) {
      // If the alpha value has value.
      // Due to anti aliasing, not all of the pixels in the array have an alpha
      //    value of 0, 255/2 is an imperfect fix which doesn't change the initial
      //    pixels drawn but does take in more pixels than searching for those equal
      //    to 0. TODO: fix drawing with npm js px-brush.
      if (paintedImageData[i + 3] > 255 / 2) {
        paintedMask.add(i);
      }
      // TODO: loop over (x, y) coordinates to avoid complication in error prone logic.
      if (i === currRightTopIndex) {
        // Minus 4 to account for i += 4 in loop.
        i =
          this.magicWandService.coordToDataArrayIndex(
            leftTop.x,
            ++newTopY,
            this.image.width
          ) - 4;
        currRightTopIndex = this.magicWandService.coordToDataArrayIndex(
          rightBottom.x,
          newTopY,
          this.image.width
        );
      }
    }
    return paintedMask;
  }

  /** Calls the undo/redo 'do' function with paintedMask: Set of imageData indexes. */
  async doMaskActionPaint(): Promise<void> {
    let paintedMask = await this.getPaintedSet();
    let maskAction = new MaskAction(
      this.maskTool === MaskTool.PAINT ? Action.ADD : Action.SUBTRACT,
      this.maskTool === MaskTool.PAINT ? Tool.PAINTBRUSH : Tool.ERASER,
      paintedMask
    );

    if (maskAction.getActionType() === Action.SUBTRACT) {
      this.maskControllerService.do(maskAction, this.allPixels);
    } else {
      this.maskControllerService.do(maskAction);
    }
  }

  /**
   * Catches the emitted zoom event and scales canvas based on user preference, in or out.
   * @param zoomIn boolean to determine if user would like to zoom in or out.
   * TODO: MAKE ZOOM A TOGGLE FEATURE AND ZOOM WHERE USER CLICKS
   */
  zoom(zoom: Zoom) {
    this.setScaleFactor(zoom);
    this.drawScaledImage(this.destinationCoords.x, this.destinationCoords.y);
    this.drawMask(this.destinationCoords.x, this.destinationCoords.y);
  }

  /**
   *  Inputs the offset of the user's click to where they pan to.
   *  @param destination : Coordinate of the offset from where to user clicked on
   *  the image to where they moved the mouse.
   *  TODO: Adjust destination so the user cannot pan past the edge of the image.
   */
  pan(destination: Coordinate) {
    this.drawScaledImage(destination.x, destination.y);
    this.drawMask(destination.x, destination.y);
  }

  /**
   *  Inputs the offset of the user's click to where they pan to and sets the
   *  new x & y destination parameters to draw the image at.
   *  @param destination : Coordinate of the offset from where to user clicked on
   *  the image to where they lifted the mouse.
   *  TODO: Adjust destination so the user cannot pan past the edge of the image.
   */
  setDestinationCoords(destination: Coordinate) {
    this.destinationCoords = destination;
    this.pan(this.destinationCoords);
  }
}

// Required for typescript compiler; used for typing with cursorCanvas.
// Represents a cursor position (coordinate w/ x, y properties).
interface CursorPos {
  x: number;
  y: number;
}

class Rectangle {
  imageWidth: number;
  imageHeight: number;
  brushRadius: number;
  // Lowest y touched by the brush.
  top: number;
  // Highest y touched by the brush.
  bottom: number;
  // Lowest x touched by the brush.
  left: number;
  // Highest x touched by the brush.
  right: number;

  constructor(
    imageWidth: number,
    imageHeight: number,
    brushWidth: number,
    coord: Coordinate
  ) {
    this.imageWidth = imageWidth;
    this.imageHeight = imageHeight;
    this.brushRadius = brushWidth / 2;

    this.top = Math.max(coord.y - this.brushRadius, 0);
    this.bottom = Math.min(coord.y + this.brushRadius, this.imageHeight - 1);

    this.left = Math.max(coord.x - this.brushRadius, 0);
    this.right = Math.min(coord.x + this.brushRadius, this.imageWidth - 1);
  }

  /** Compares the index's left, right, top, and bottom most pixel based on the brush radius to the current max and mins of all members */
  compareCoordinateToCurrentRectangle(coord: Coordinate) {
    const topY = Math.max(coord.y - this.brushRadius, 0);
    const bottomY = Math.min(coord.y + this.brushRadius, this.imageHeight - 1);

    const leftX = Math.max(coord.x - this.brushRadius, 0);
    const rightX = Math.min(coord.x + this.brushRadius, this.imageWidth - 1);

    if (this.top > topY) {
      this.top = topY;
    }
    if (this.bottom < bottomY) {
      this.bottom = bottomY;
    }
    if (this.left > leftX) {
      this.left = leftX;
    }
    if (this.right < rightX) {
      this.right = rightX;
    }
  }

  /**
   *  @returns {Coordinate} the floored (x,y) of the combination of the left
   *    most and top most coordinate the users brush touched.
   *  Floor is needed to calculate the proper index in the data array.
   *    It allows the index to be a valid (x,y) coordinate
   */
  getLeftTop(): Coordinate {
    return new Coordinate(Math.floor(this.left), Math.floor(this.top));
  }
  /**
   *  @returns {Coordinate} the ceiling of the (x,y) combination from the
   *    right most and bottom most coordinate the users brush touched.
   *  Ceil is needed to calculate the proper index in the data array.
   *    It allows the index to be a valid (x,y) coordinate.
   */
  getRightBottom(): Coordinate {
    return new Coordinate(Math.ceil(this.right), Math.ceil(this.bottom));
  }
}
