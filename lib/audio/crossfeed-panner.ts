/**
 * CrossfeedPanner - A spatial audio panner that simulates natural hearing
 * by adding delayed, attenuated signals to the opposite channel.
 *
 * This creates a more natural headphone listening experience compared to
 * standard stereo panning.
 */

export class CrossfeedPanner {
  private audioContext: AudioContext
  private inputNode: GainNode
  private outputNode: ChannelMergerNode
  private panValue: number

  // Main gain nodes for each channel
  private leftGain: GainNode
  private rightGain: GainNode

  // Crossfeed delay for opposite channel signal
  private crossfeedDelay: DelayNode
  private crossfeedGain: GainNode

  // Crossfeed parameters
  private static readonly MAX_DELAY_MS = 0.3 // milliseconds (roughly matches interaural time difference)
  private static readonly CROSSFEED_LEVEL = 0.25 // Amount of opposite channel to mix in

  constructor(audioContext: AudioContext, panValue: number = 0) {
    this.audioContext = audioContext
    this.panValue = Math.max(-1, Math.min(1, panValue))

    // Create nodes
    this.inputNode = this.audioContext.createGain()
    this.outputNode = this.audioContext.createChannelMerger(2)

    // Create gain nodes for panning
    this.leftGain = this.audioContext.createGain()
    this.rightGain = this.audioContext.createGain()

    // Create crossfeed path
    this.crossfeedDelay = this.audioContext.createDelay(1)
    this.crossfeedGain = this.audioContext.createGain()

    // Set up routing
    this.setupRouting()

    // Apply initial pan
    this.setPan(panValue)
  }

  private setupRouting(): void {
    // For a mono input signal that we want to pan:
    // 1. Direct path: input -> leftGain -> left channel
    //                 input -> rightGain -> right channel
    // 2. Crossfeed: The dominant channel feeds a delayed signal to the opposite channel

    // Direct paths
    this.inputNode.connect(this.leftGain)
    this.inputNode.connect(this.rightGain)

    // Connect to output channels
    this.leftGain.connect(this.outputNode, 0, 0) // To left channel
    this.rightGain.connect(this.outputNode, 0, 1) // To right channel

    // Crossfeed path (we'll connect this dynamically based on pan direction)
    this.crossfeedGain.connect(this.crossfeedDelay)
  }

  /**
   * Set the pan position
   * @param value Pan value from -1 (left) to 1 (right)
   */
  public setPan(value: number): void {
    this.panValue = Math.max(-1, Math.min(1, value))

    // Disconnect existing crossfeed connections
    try {
      this.inputNode.disconnect(this.crossfeedGain)
      this.crossfeedDelay.disconnect()
    } catch {
      // Ignore - connections might not exist
    }

    // Calculate equal-power panning gains
    const angle = (this.panValue * 0.5 + 0.5) * Math.PI / 2 // 0 to PI/2
    const leftLevel = Math.cos(angle)
    const rightLevel = Math.sin(angle)

    // Set main channel gains
    this.leftGain.gain.setValueAtTime(leftLevel, this.audioContext.currentTime)
    this.rightGain.gain.setValueAtTime(rightLevel, this.audioContext.currentTime)

    // Calculate crossfeed based on pan position
    const absPan = Math.abs(this.panValue)

    if (absPan > 0.1) { // Only apply crossfeed when panned
      // Delay is proportional to pan amount (simulating interaural time difference)
      const delayTime = absPan * CrossfeedPanner.MAX_DELAY_MS / 1000
      this.crossfeedDelay.delayTime.setValueAtTime(delayTime, this.audioContext.currentTime)

      // Crossfeed gain decreases as we pan harder
      const crossfeedLevel = CrossfeedPanner.CROSSFEED_LEVEL * (1 - absPan * 0.5)
      this.crossfeedGain.gain.setValueAtTime(crossfeedLevel, this.audioContext.currentTime)

      // Connect crossfeed from input to the OPPOSITE channel
      this.inputNode.connect(this.crossfeedGain)

      if (this.panValue < 0) {
        // Panned left: add delayed signal to RIGHT channel
        this.crossfeedDelay.connect(this.outputNode, 0, 1)
      } else {
        // Panned right: add delayed signal to LEFT channel
        this.crossfeedDelay.connect(this.outputNode, 0, 0)
      }
    } else {
      // Center position: no crossfeed needed
      this.crossfeedGain.gain.setValueAtTime(0, this.audioContext.currentTime)
    }
  }

  /**
   * Get the input node for connecting sources
   */
  public getInputNode(): GainNode {
    return this.inputNode
  }

  /**
   * Get the output node for connecting to destination
   */
  public getOutputNode(): AudioNode {
    return this.outputNode
  }

  /**
   * Connect the output to a destination node
   */
  public connect(destination: AudioNode): void {
    this.outputNode.connect(destination)
  }

  /**
   * Disconnect all connections
   */
  public disconnect(): void {
    this.inputNode.disconnect()
    this.leftGain.disconnect()
    this.rightGain.disconnect()
    this.crossfeedGain.disconnect()
    this.crossfeedDelay.disconnect()
    this.outputNode.disconnect()
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.disconnect()
  }
}