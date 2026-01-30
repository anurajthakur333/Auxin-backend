import mongoose, { Document, Schema } from 'mongoose';

export interface IInvoiceItem {
  title: string;
  price: number;
  quantity: number;
  subtotal: number;
}

export interface ICompanyAddress {
  companyName: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface IClientAddress {
  name: string;
  email: string;
  address: string;
  gstNumber?: string;
}

export interface IPaymentMethod {
  bankName?: string;
  accountHolderName?: string;
  accountNumber?: string;
  routingNumber?: string;
  swiftCode?: string;
  branchAddress?: string;
  accountType?: string;
}

export interface IInvoice extends Document {
  _id: string;
  invoiceNumber: string; // Auto-generated: INV-YYYY-XXX
  clientId: mongoose.Types.ObjectId; // Reference to User
  projectId?: mongoose.Types.ObjectId; // Reference to Project (optional)
  projectCode?: string; // Project code for easy reference
  date: Date;
  dueDate: Date;
  billTo: IClientAddress;
  companyAddress: ICompanyAddress;
  items: IInvoiceItem[];
  discount: number;
  sgst: number;
  cgst: number;
  total: number;
  paymentTerms?: string;
  paymentMethod?: IPaymentMethod;
  status: 'pending' | 'paid' | 'overdue';
  paypalOrderId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceItemSchema = new Schema<IInvoiceItem>({
  title: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  subtotal: { type: Number, required: true, min: 0 },
}, { _id: false });

const CompanyAddressSchema = new Schema<ICompanyAddress>({
  companyName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true },
  street: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  zip: { type: String, required: true, trim: true },
  country: { type: String, required: true, trim: true },
}, { _id: false });

const ClientAddressSchema = new Schema<IClientAddress>({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  gstNumber: { type: String, trim: true },
}, { _id: false });

const PaymentMethodSchema = new Schema<IPaymentMethod>({
  bankName: { type: String, trim: true },
  accountHolderName: { type: String, trim: true },
  accountNumber: { type: String, trim: true },
  routingNumber: { type: String, trim: true },
  swiftCode: { type: String, trim: true },
  branchAddress: { type: String, trim: true },
  accountType: { type: String, trim: true },
}, { _id: false });

const InvoiceSchema = new Schema<IInvoice>({
  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: function() {
      // Temporary default that will be replaced in pre-save hook
      return `TEMP-${Date.now()}`;
    },
  },
  clientId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    index: true,
  },
  projectCode: {
    type: String,
    trim: true,
    uppercase: true,
    index: true,
  },
  date: {
    type: Date,
    required: true,
  },
  dueDate: {
    type: Date,
    required: true,
  },
  billTo: {
    type: ClientAddressSchema,
    required: true,
  },
  companyAddress: {
    type: CompanyAddressSchema,
    required: true,
  },
  items: {
    type: [InvoiceItemSchema],
    required: true,
    validate: {
      validator: (items: IInvoiceItem[]) => items.length > 0,
      message: 'At least one item is required',
    },
  },
  discount: {
    type: Number,
    default: 0,
    min: 0,
  },
  sgst: {
    type: Number,
    default: 0,
    min: 0,
  },
  cgst: {
    type: Number,
    default: 0,
    min: 0,
  },
  total: {
    type: Number,
    required: true,
    min: 0,
  },
  paymentTerms: {
    type: String,
    trim: true,
  },
  paymentMethod: {
    type: PaymentMethodSchema,
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'overdue'],
    default: 'pending',
    index: true,
  },
  paypalOrderId: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
  toJSON: {
    transform: function(_doc, ret: Record<string, unknown>) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
});

// Indexes
InvoiceSchema.index({ clientId: 1, createdAt: -1 });
InvoiceSchema.index({ status: 1 });
InvoiceSchema.index({ dueDate: 1 });

// Auto-generate invoice number before saving
InvoiceSchema.pre('save', async function(next) {
  // Only generate if this is a new document
  if (!this.isNew) {
    return next();
  }

  // If invoiceNumber is already set and valid (not a temp value), skip generation
  if (this.invoiceNumber && !this.invoiceNumber.startsWith('TEMP-')) {
    console.log(`ℹ️ Invoice number already set: ${this.invoiceNumber}`);
    return next();
  }

  // Always generate invoice number for new documents
  try {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    
    // Use this.constructor to get the model (works in pre-save hooks)
    const InvoiceModel = this.constructor as mongoose.Model<IInvoice>;
    
    // Find the highest invoice number for this year
    // Escape special regex characters in prefix
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    let lastInvoice: Partial<IInvoice> | null = null;
    try {
      const result = await InvoiceModel
        .findOne({ 
          invoiceNumber: { $regex: `^${escapedPrefix}`, $options: 'i' }
        })
        .sort({ invoiceNumber: -1 })
        .lean();
      lastInvoice = result as Partial<IInvoice> | null;
    } catch (queryError: any) {
      console.warn('⚠️ Could not query for last invoice, using sequence 1:', queryError.message);
    }

    let sequence = 1;
    if (lastInvoice && lastInvoice.invoiceNumber && typeof lastInvoice.invoiceNumber === 'string') {
      const parts = lastInvoice.invoiceNumber.split('-');
      if (parts.length >= 3) {
        const lastSequence = parseInt(parts[2] || '0', 10);
        if (!isNaN(lastSequence) && lastSequence > 0) {
          sequence = lastSequence + 1;
        }
      }
    }

    this.invoiceNumber = `${prefix}${sequence.toString().padStart(3, '0')}`;
    console.log(`✅ Generated invoice number: ${this.invoiceNumber}`);
    next();
  } catch (error: any) {
    console.error('❌ Error generating invoice number:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    // Always set a fallback invoice number to prevent validation errors
    const year = new Date().getFullYear();
    const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
    this.invoiceNumber = `INV-${year}-${timestamp}`;
    console.log(`⚠️ Using fallback invoice number: ${this.invoiceNumber}`);
    next();
  }
});

// Pre-validate hook: Set a temporary invoice number before validation runs
// This ensures the required field passes validation, then pre-save will replace it with the real number
InvoiceSchema.pre('validate', function(next) {
  if (this.isNew && (!this.invoiceNumber || this.invoiceNumber.startsWith('TEMP-'))) {
    const year = new Date().getFullYear();
    const timestamp = Date.now().toString().slice(-6);
    this.invoiceNumber = `TEMP-${year}-${timestamp}`;
  }
  next();
});

const Invoice = mongoose.models.Invoice || mongoose.model<IInvoice>('Invoice', InvoiceSchema);
export default Invoice;
